/**
 * Bambu Lab P1S Pricing Engine
 * Implements the exact pricing formula from Feature Spec Section 2:
 *
 * material_cost   = (model_weight_g + support_weight_g) * material_rate_per_g * waste_factor
 * machine_cost    = (print_time_seconds / 3600) * p1s_hourly_rate
 * setup_qa_fee    = base_setup_fee + support_tier_surcharge(support_weight_g / model_weight_g)
 * failure_buffer  = (material_cost + machine_cost) * (failure_rate_pct / 100)
 * subtotal        = material_cost + machine_cost + setup_qa_fee + failure_buffer
 * total           = Math.max(minimum_order_fee, subtotal * (1 + margin_pct / 100) * qty * (1 - discountPct))
 */

const DEFAULT_PRICING_CONFIG = {
  p1sHourlyRate: 0,             // ₹ / hour (₹0 for college lab)
  baseSetupFee: 0,              // ₹ flat setup & prep (₹0 for college lab)
  wasteFactor: 1.10,            // 1.05 - 1.15 (10% waste/purge buffer)
  failureRatePct: 8,            // 8% scrap buffer
  marginPct: 0,                 // 0% profit margin for college lab cost-recovery
  minimumOrderFee: 20,          // ₹ nominal floor price
  supportTierLowPct: 5,         // Below 5%: no surcharge
  supportTierMidPct: 15,        // 5% - 15%
  supportTierSurchargeMid: 0,   // ₹0 for college lab
  supportTierSurchargeHigh: 0,  // ₹0 for college lab
  multiColorEnabled: true,      // Admin toggle for multi-color surcharge
  multiColorFee: 5,             // ₹5 extra for multiple colors
  tier1MinQty: 5,
  tier1Discount: 10,            // %
  tier2MinQty: 10,
  tier2Discount: 15             // %
};

function calculateP1SPrice({
  modelWeightG,
  supportWeightG = 0,
  printTimeSeconds,
  materialRatePerG,
  qty = 1,
  colorsCount = 1,
  config = {}
}) {
  const cfg = { ...DEFAULT_PRICING_CONFIG, ...config };

  const totalFilamentG = Math.max(0, modelWeightG + supportWeightG);
  const wasteFactor = cfg.wasteFactor ?? 1.10;
  const materialRate = materialRatePerG || 1.50;

  // 1. Material cost with waste factor
  const modelMaterialCost = modelWeightG * materialRate * wasteFactor;
  const supportMaterialCost = supportWeightG * materialRate * wasteFactor;
  const materialCost = totalFilamentG * materialRate * wasteFactor;

  // 2. Machine cost based on P1S hourly rate
  const printHours = Math.max(0, printTimeSeconds) / 3600;
  const machineCost = printHours * (cfg.p1sHourlyRate || 0);

  // 3. Support tier surcharge
  const supportRatio = modelWeightG > 0 ? (supportWeightG / modelWeightG) * 100 : 0;
  let supportSurcharge = 0;
  let supportTier = 'none';

  if (supportWeightG > 0) {
    if (supportRatio >= (cfg.supportTierMidPct || 15)) {
      supportSurcharge = cfg.supportTierSurchargeHigh || 0;
      supportTier = 'high';
    } else if (supportRatio >= (cfg.supportTierLowPct || 5)) {
      supportSurcharge = cfg.supportTierSurchargeMid || 0;
      supportTier = 'mid';
    } else {
      supportTier = 'low';
    }
  }

  // 4. Setup & QA fee
  const setupQAFee = (cfg.baseSetupFee || 0) + supportSurcharge;

  // 5. Failure buffer
  const failureBuffer = (materialCost + machineCost) * ((cfg.failureRatePct || 8) / 100);

  // 6. Multi-color (AMS) surcharge
  const isMultiColor = colorsCount > 1;
  const multiColorCharge = (isMultiColor && cfg.multiColorEnabled !== false) ? (cfg.multiColorFee ?? 5) : 0;

  // 7. Subtotal before margin
  const unitSubtotal = materialCost + machineCost + setupQAFee + failureBuffer + multiColorCharge;

  // 8. Margin addition
  const marginAmt = unitSubtotal * ((cfg.marginPct || 0) / 100);
  const unitPrice = unitSubtotal + marginAmt;

  // 9. Quantity & bulk discount
  let discountPct = 0;
  if (qty >= (cfg.tier2MinQty || 10)) {
    discountPct = (cfg.tier2Discount || 15) / 100;
  } else if (qty >= (cfg.tier1MinQty || 5)) {
    discountPct = (cfg.tier1Discount || 10) / 100;
  }

  const rawOrderTotal = unitPrice * qty * (1 - discountPct);
  const minOrderFee = cfg.minimumOrderFee || 0;
  const finalTotal = Math.max(minOrderFee, rawOrderTotal);
  const minFeeApplied = finalTotal > rawOrderTotal;

  // Turnaround days estimation: based on print hours and machine capacity
  const totalMachineHours = printHours * qty;
  const turnaroundDays = Math.max(1, Math.ceil(totalMachineHours / 8)) + 1;

  return {
    unitCost: Math.round(unitPrice * 100) / 100,
    unitSubtotal: Math.round(unitSubtotal * 100) / 100,
    materialCost: Math.round(materialCost * 100) / 100,
    modelMaterialCost: Math.round(modelMaterialCost * 100) / 100,
    supportMaterialCost: Math.round(supportMaterialCost * 100) / 100,
    machineCost: Math.round(machineCost * 100) / 100,
    setupQAFee: Math.round(setupQAFee * 100) / 100,
    baseSetupFee: cfg.baseSetupFee || 0,
    supportSurcharge,
    supportTier,
    multiColorCharge,
    multiColorEnabled: cfg.multiColorEnabled !== false,
    colorsCount,
    supportRatioPct: Math.round(supportRatio * 10) / 10,
    hasSupports: supportWeightG > 0,
    failureBuffer: Math.round(failureBuffer * 100) / 100,
    marginAmt: Math.round(marginAmt * 100) / 100,
    discountPct: discountPct * 100,
    discountAmt: Math.round((unitPrice * qty * discountPct) * 100) / 100,
    rawOrderTotal: Math.round(rawOrderTotal * 100) / 100,
    total: Math.round(finalTotal * 100) / 100,
    minFeeApplied,
    minimumOrderFee: minOrderFee,
    printHours: Math.round(printHours * 10) / 10,
    turnaroundDays,
    breakdown: {
      modelWeightG: Math.round(modelWeightG * 100) / 100,
      supportWeightG: Math.round(supportWeightG * 100) / 100,
      totalFilamentG: Math.round(totalFilamentG * 100) / 100,
      printTimeSeconds
    }
  };
}

module.exports = {
  calculateP1SPrice,
  DEFAULT_PRICING_CONFIG
};

/**
 * OrcaSlicer Output & G-code Parser
 * Extracts filament weights (model vs support) and print time from OrcaSlicer CLI output & G-code headers.
 */

function parseSlicerOutput(stdout, gcodeContent = '') {
  let modelWeightG = 0;
  let supportWeightG = 0;
  let totalWeightG = 0;
  let printTimeSeconds = 0;
  let filamentByExtruder = [];

  const combinedText = `${stdout || ''}\n${gcodeContent || ''}`;

  // 1. Total filament weight
  // Match: ; filament used [g] = 42.15 OR ; total filament used [g] = 42.15 OR Total filament: 42.15g
  const totalWeightMatch = combinedText.match(/;\s*(?:total\s+)?filament\s+(?:used\s+)?\[g\]\s*=\s*([0-9.]+)/i) ||
                           combinedText.match(/;\s*filament_weight\s*=\s*([0-9.]+)/i) ||
                           combinedText.match(/Total\s+filament(?:\s+weight)?:\s*([0-9.]+)\s*g/i);
  if (totalWeightMatch) {
    totalWeightG = parseFloat(totalWeightMatch[1]);
  }

  // 2. Model filament weight
  const modelWeightMatch = combinedText.match(/;\s*model\s+filament(?:\s+used)?\s*\[g\]\s*=\s*([0-9.]+)/i) ||
                           combinedText.match(/Model(?:\s+filament)?:\s*([0-9.]+)\s*g/i);
  if (modelWeightMatch) {
    modelWeightG = parseFloat(modelWeightMatch[1]);
  }

  // 3. Support filament weight
  const supportWeightMatch = combinedText.match(/;\s*support\s+filament(?:\s+used)?\s*\[g\]\s*=\s*([0-9.]+)/i) ||
                             combinedText.match(/Support(?:\s+filament)?:\s*([0-9.]+)\s*g/i);
  if (supportWeightMatch) {
    supportWeightG = parseFloat(supportWeightMatch[1]);
  }

  // If total is present but split is missing
  if (totalWeightG > 0 && modelWeightG === 0 && supportWeightG === 0) {
    modelWeightG = totalWeightG;
  } else if (totalWeightG === 0 && (modelWeightG > 0 || supportWeightG > 0)) {
    totalWeightG = modelWeightG + supportWeightG;
  }

  // 4. Print time parsing
  // Match seconds directly: ; total estimated time = 6135 OR estimated printing time = 6135s
  const timeSecondsMatch = combinedText.match(/;\s*(?:total\s+estimated\s+time|estimated_print_time)\s*=\s*([0-9]+)/i);
  if (timeSecondsMatch) {
    printTimeSeconds = parseInt(timeSecondsMatch[1], 10);
  } else {
    // Match human format: 1d 2h 30m 15s OR 2h 15m 30s OR 45m 12s
    const humanTimeMatch = combinedText.match(/;\s*estimated\s+printing\s+time\s*(?:\([^)]*\))?\s*=\s*([0-9dhms\s]+)/i) ||
                           combinedText.match(/Estimated\s+print\s+time:\s*([0-9dhms\s]+)/i);
    if (humanTimeMatch) {
      printTimeSeconds = parseHumanDuration(humanTimeMatch[1]);
    }
  }

  // 5. Multi-material / extruder breakdown
  const extruderMatches = combinedText.matchAll(/;\s*filament\s+used\s+by\s+extruder\s*\[(\d+)\]\s*\[g\]\s*=\s*([0-9.]+)/gi);
  for (const match of extruderMatches) {
    filamentByExtruder.push({
      extruder: parseInt(match[1], 10),
      weightG: parseFloat(match[2])
    });
  }

  return {
    total_filament_weight_g: Math.round(totalWeightG * 100) / 100,
    model_filament_weight_g: Math.round(modelWeightG * 100) / 100,
    support_filament_weight_g: Math.round(supportWeightG * 100) / 100,
    estimated_print_time_seconds: Math.round(printTimeSeconds),
    filament_used_by_extruder: filamentByExtruder
  };
}

function parseHumanDuration(str) {
  let seconds = 0;
  const days = str.match(/(\d+)\s*d/);
  const hours = str.match(/(\d+)\s*h/);
  const minutes = str.match(/(\d+)\s*m/);
  const secs = str.match(/(\d+)\s*s/);

  if (days) seconds += parseInt(days[1], 10) * 86400;
  if (hours) seconds += parseInt(hours[1], 10) * 3600;
  if (minutes) seconds += parseInt(minutes[1], 10) * 60;
  if (secs) seconds += parseInt(secs[1], 10);

  return seconds;
}

module.exports = {
  parseSlicerOutput,
  parseHumanDuration
};

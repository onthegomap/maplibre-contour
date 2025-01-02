#!/bin/bash

# Default Values (except demUrl and oDir)
increment_default=0
sMaxZoom_default=8
sEncoding_default="mapbox"
oMaxZoom_default=8
oMinZoom_default=5
oDir_default=./output

# Function to parse command line arguments
parse_arguments() {
  local verbose=false
  local demUrl=""
  local oDir="$oDir_default"
  local increment="$increment_default"
  local sMaxZoom="$sMaxZoom_default"
  local sEncoding="$sEncoding_default"
  local oMaxZoom="$oMaxZoom_default"
  local oMinZoom="$oMinZoom_default"
    
  while [[ $# -gt 0 ]]; do
    case "$1" in
    -h|--help) usage; exit 1;; # Show usage and exit
    --increment) increment="$2"; shift 2 ;;
    --sMaxZoom) sMaxZoom="$2"; shift 2 ;;
    --sEncoding) sEncoding="$2"; shift 2 ;;
    --demUrl) demUrl="$2"; shift 2 ;;
    --oDir) oDir="$2"; shift 2 ;;
    --oMaxZoom) oMaxZoom="$2"; shift 2 ;;
    --oMinZoom) oMinZoom="$2"; shift 2 ;;    
    -v|--verbose) verbose=true; shift ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;; # Return non-zero on error
    esac
  done

  # Check if demUrl and oDir are provided
  if [[ -z "$demUrl" ]]; then
    echo "Error: --demUrl is required." >&2
    usage
    exit 1 # Return non-zero on error
  fi
    
  # Check if sEncoding is valid
  if [[ "$sEncoding" != "mapbox" && "$sEncoding" != "terrarium" ]]; then
    echo "Error: --sEncoding must be either 'mapbox' or 'terrarium'." >&2
    usage
    exit 1 # Return non-zero on error
  fi

  # Return the values as a single string
  echo "$oMinZoom $demUrl $oDir $increment $sMaxZoom $sEncoding $oMaxZoom $verbose"
  return 0 # return zero for success
}

usage() {
  echo "Usage: $0 --demUrl <path> [options]" >&2
  echo " Options:" >&2
  echo "  --increment <value> Increment value (default: $increment_default)" >&2
  echo "  --sMaxZoom <value> Source Max Zoom (default: $sMaxZoom_default)" >&2
  echo "  --sEncoding <encoding> Source Encoding (default: $sEncoding_default) (must be 'mapbox' or 'terrarium')" >&2
  echo "  --demUrl <path>  TerrainRGB or Terrarium PMTiles https:// URL or pmtiles:// URL (REQUIRED)" >&2
  echo "  --oDir <path>  Output Directory (default: $oDir_default)" >&2
  echo "  --oMaxZoom <value> Output Max Zoom (default: $oMaxZoom_default)" >&2
  echo "  --oMinZoom <value> Output Min Zoom (default: $oMinZoom_default)" >&2
  echo "  -v|--verbose  Enable verbose output" >&2
  echo "  -h|--help  Show this usage statement" >&2
}

# Initialize with defaults
demUrl=""
oDir="$oDir_default"
increment="$increment_default"
sMaxZoom="$sMaxZoom_default"
sEncoding="$sEncoding_default"
oMaxZoom="$oMaxZoom_default"
oMinZoom="$oMinZoom_default"


process_tile() {
  local programOptions="$0"
  local zoom_level="$1"
  local x_coord="$2"
  local y_coord="$3"

  read oMinZoom demUrl oDir increment sMaxZoom sEncoding oMaxZoom verbose <<< "$programOptions"


  if [[ "$verbose" = "true" ]]; then
    echo "process_tile: [START] Processing tile - Zoom: $zoom_level, X: $x_coord, Y: $y_coord, oMaxZoom: $oMaxZoom"
  fi
  

  npx tsx ../src/generate-countour-tile-batch.ts \
    --x "$x_coord" \
    --y "$y_coord" \
    --z "$zoom_level" \
    --demUrl "$demUrl" \
    --sEncoding "$sEncoding" \
    --sMaxZoom "$sMaxZoom" \
    --increment "$increment" \
    --oMaxZoom "$oMaxZoom" \
    --oDir "$oDir"
      
  if [[ "$verbose" = "true" ]]; then
  echo "process_tile: [END] Finished processing $zoom_level-$x_coord-$y_coord"
  fi
}
export -f process_tile

# Function to generate tile coordinates and output them as a single space delimited string variable.
generate_tile_coordinates() {
  local zoom_level=$1
  local tiles_in_dimension=$(echo "2^$zoom_level" | bc)

  local output=""

  for ((y=0; y<$tiles_in_dimension; y++)); do
    for ((x=0; x<$tiles_in_dimension; x++)); do
    output+="$zoom_level $x $y "
    done
  done

  echo -n "$output"
  return 
}

# --- Main Script ---
# Parse arguments and validate, getting the min zoom level

programOptions=$(parse_arguments "$@")
ret=$? # capture exit status
if [[ "$ret" -ne 0 ]]; then
  exit "$ret"
fi

# Assign the program options to the variables
read oMinZoom demUrl oDir increment sMaxZoom sEncoding oMaxZoom verbose <<< "$programOptions"

echo "Source File: $demUrl"
echo "Source Max Zoom: $sMaxZoom"
echo "Source Encoding: $sEncoding"
echo "Output Directory: $oDir"
echo "Output Min Zoom: $oMinZoom"
echo "Output Max Zoom: $oMaxZoom"
echo "Contour Increment: $increment"
echo "Main: [START] Processing tiles."

# Capture the return value using a pipe.
tile_coords_str=$(generate_tile_coordinates "$oMinZoom")

if [[ $? -eq 0 ]]; then
  if [[ "$verbose" = "true" ]]; then
  echo "Main: [INFO] Starting tile processing for zoom level $oMinZoom"
  fi
  echo "$tile_coords_str" | xargs -P 8 -n 3 bash -c 'process_tile "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9"'  "$programOptions"
  if [[ "$verbose" = "true" ]]; then
  echo "Main: [INFO] Finished tile processing for zoom level $oMinZoom"
  fi
else
  echo "Error generating tiles" >&2
  exit 1
fi

echo "Main: [END] Finished processing all tiles at zoom level $oMinZoom."

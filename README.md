# Figma to Spine2D

A script for extracting vector images from Figma documents.

> This documentation is also [available in Russian](README_ru.md).

## Requirements

This script requires **Node.js** (version 22 or higher) - a JavaScript runtime environment that allows you to run JavaScript code on your computer.

### Installing Node.js:

1. Visit the official Node.js website: [https://nodejs.org/](https://nodejs.org/)
2. Download the installer for your operating system (Windows, macOS, or Linux)
3. Run the installer and follow the installation wizard
4. After installation, verify it worked by opening a terminal/command prompt and typing:
   ```bash
   node --version
   ```
   You should see a version number like `v22.x.x` or higher

**Note:** If you see a version lower than 22, you'll need to update Node.js to a newer version.

## Installation

```bash
git clone https://github.com/dima117/figma2spine.git
cd figma2spine
npm install
```

## Setup

1. Get a Personal Access Token in Figma:
   - Open Figma
   - Go to Settings → Account → Personal Access Tokens
   - Create a new token

2. Set the environment variable:
   ```bash
   export FIGMA_TOKEN="<your_figma_personal_access_token_here>"
   ```

## Usage

```bash
npm run test <document-id> <frame-name-pattern> [scale]
```

### Parameters:

- `document-id` - Figma document ID (can be found in URL: figma.com/file/**document-id**/...)
- `frame-name-pattern` - Regular expression for finding the frame (e.g., "Character.*" or "MainFrame")
- `scale` - (optional) Export scale factor (default: 0.5)

### Examples:

```bash
# Find frame named "Martin" (default scale 0.5)
npm run test Km5kyQgY1WeEiZtXqHncue "Martin"

# Find frame starting with "Character" with scale 1.0
npm run test abc123def456 "Character.*" 1.0

# Find frame with exact name and scale 2.0 (high resolution)
npm run test abc123def456 "^MainFrame$" 2.0

# Export with scale 0.25 (low resolution)
npm run test abc123def456 "Hero" 0.25
```

## What the script does:

1. Connects to Figma API
2. Retrieves document structure
3. Searches for a frame by the given name pattern
4. Finds all vector objects inside the frame (VECTOR, BOOLEAN_OPERATION, STAR, LINE, ELLIPSE, REGULAR_POLYGON)
5. Exports them in PNG format with the specified scale (default 0.5x)
6. Saves images to the `dist/` folder
7. Creates a JSON file for importing into Spine2D with correct object positions

## Spine2D Format:

The script automatically creates a Spine2D-compatible JSON file:
- Creates a root bone
- Creates a slot for each image
- Object positions are calculated relative to the frame center
- Sizes account for the scale factor
- Coordinate system is adapted for Spine2D (Y is inverted)

After importing the JSON file into Spine2D, you'll get a set of slots with images positioned exactly as in the original Figma frame.

## Vector Object Types:

The script extracts the following object types:
- VECTOR - vector paths
- BOOLEAN_OPERATION - boolean operations
- STAR - stars
- LINE - lines
- ELLIPSE - ellipses
- REGULAR_POLYGON - regular polygons

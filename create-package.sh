#!/bin/bash

# Chrome Web Store Package Creator
# YouTube Summarizer - General Edition v1.0.0

echo "🚀 Creating Chrome Web Store Package for YouTube Summarizer General Edition"
echo "=================================================================="

# Configuration
EXTENSION_NAME="youtube-summarizer-general"
VERSION="v1.0.0"
DIST_DIR="dist"
PACKAGE_DIR="$DIST_DIR/$EXTENSION_NAME-$VERSION"
ZIP_FILE="$DIST_DIR/$EXTENSION_NAME-$VERSION.zip"

# Create distribution directory
echo "📁 Creating distribution directory..."
mkdir -p "$PACKAGE_DIR"

# Copy essential extension files
echo "📋 Copying core extension files..."
cp manifest.json "$PACKAGE_DIR/"
cp popup.html "$PACKAGE_DIR/"
cp options.html "$PACKAGE_DIR/"

# Copy JavaScript files
echo "📜 Copying JavaScript files..."
mkdir -p "$PACKAGE_DIR/js"
cp js/background.js "$PACKAGE_DIR/js/"
cp js/content.js "$PACKAGE_DIR/js/"
cp js/popup.js "$PACKAGE_DIR/js/"
cp js/options.js "$PACKAGE_DIR/js/"

# Copy CSS files
echo "🎨 Copying CSS files..."
mkdir -p "$PACKAGE_DIR/css"
cp css/content.css "$PACKAGE_DIR/css/"
cp css/popup.css "$PACKAGE_DIR/css/"
cp css/options.css "$PACKAGE_DIR/css/"

# Copy image files
echo "🖼️  Copying image files..."
mkdir -p "$PACKAGE_DIR/images"
cp images/icon16.png "$PACKAGE_DIR/images/"
cp images/icon32.png "$PACKAGE_DIR/images/"
cp images/icon48.png "$PACKAGE_DIR/images/"
cp images/icon128.png "$PACKAGE_DIR/images/"

# Copy README for users (optional)
if [ -f "README.md" ]; then
    echo "📖 Including README.md for users..."
    cp README.md "$PACKAGE_DIR/"
fi

# Create ZIP package
echo "📦 Creating ZIP package..."
cd "$DIST_DIR"
zip -r "$EXTENSION_NAME-$VERSION.zip" "$EXTENSION_NAME-$VERSION/"
cd ..

# Verify package contents
echo "✅ Verifying package contents..."
echo "Files in package:"
unzip -l "$ZIP_FILE"

# Calculate package size
PACKAGE_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo ""
echo "📊 Package Information:"
echo "=================================================================="
echo "📁 Package Directory: $PACKAGE_DIR"
echo "📦 ZIP File: $ZIP_FILE"
echo "📏 Package Size: $PACKAGE_SIZE"
echo "🏷️  Version: $VERSION"

# Validation
echo ""
echo "🔍 Package Validation:"
echo "=================================================================="

# Check if all required files exist
REQUIRED_FILES=(
    "manifest.json"
    "popup.html"
    "options.html"
    "js/background.js"
    "js/content.js"
    "js/popup.js"
    "js/options.js"
    "css/content.css"
    "css/popup.css"
    "css/options.css"
    "images/icon16.png"
    "images/icon32.png"
    "images/icon48.png"
    "images/icon128.png"
)

MISSING_FILES=0
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$PACKAGE_DIR/$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (MISSING)"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
done

echo ""
if [ $MISSING_FILES -eq 0 ]; then
    echo "🎉 Package validation PASSED! All required files present."
    echo ""
    echo "📋 Next Steps:"
    echo "1. Test the extension by loading '$PACKAGE_DIR' in Chrome Developer Mode"
    echo "2. If working correctly, use '$ZIP_FILE' for Chrome Web Store submission"
    echo "3. Follow the instructions in CHROME_WEB_STORE_SUBMISSION.md"
else
    echo "⚠️  Package validation FAILED! $MISSING_FILES required files are missing."
    echo "Please check the missing files and run this script again."
fi

echo ""
echo "🚀 Chrome Web Store Package Creation Complete!"
echo "=================================================================="

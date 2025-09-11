# Chrome Web Store Screenshot Resize Guide

## 🎯 Exact Requirements
- **Size**: 1280x800 pixels (exactly)
- **Aspect Ratio**: 16:10 
- **Format**: PNG (recommended) or JPEG
- **Color**: 24-bit, no alpha channel
- **File Size**: Under 16MB each

## 🔧 Quick Resize Solutions

### Option 1: Using Preview (Mac Built-in)
1. Open screenshot in **Preview**
2. Go to **Tools** > **Adjust Size**
3. Set **Width: 1280** and **Height: 800**
4. Ensure "Scale proportionally" is **UNCHECKED** (to force exact size)
5. Click **OK**
6. **File** > **Export** > Choose PNG > **Save**

### Option 2: Using Online Tool (Fastest)
1. Go to: https://www.iloveimg.com/resize-image
2. Upload your screenshot
3. Choose **Resize by pixels**
4. Set **Width: 1280, Height: 800**
5. **Uncheck** "Keep aspect ratio" 
6. Download resized image

### Option 3: Using Command Line (Advanced)
```bash
# Install ImageMagick (if not already installed)
brew install imagemagick

# Resize single image
magick input.png -resize 1280x800! output.png

# Resize all screenshots in folder
for file in screenshot-*.png; do
    magick "$file" -resize 1280x800! "resized-$file"
done
```

## 📸 Taking New Screenshots (Recommended)

### Browser Setup for Perfect Screenshots:
1. **Set Browser Window**: Resize to 1280x800 ratio
2. **Full Screen Capture**: Use built-in screenshot tools
3. **Crop to Exact Size**: Use Preview or image editor

### Mac Screenshot Method:
1. **Cmd + Shift + 4** for selection tool
2. Hold **Shift** while dragging to maintain aspect ratio
3. Take screenshot at 1280x800 dimensions

## 🎨 Content Guidelines for Screenshots

### Screenshot 1: Main Summary Button
- Show YouTube video page with SMART SUMMARY button visible
- Include part of video player and description area
- Button should be prominently displayed

### Screenshot 2: Initial Summary Display  
- Extension panel showing topic summaries
- Clean, professional appearance
- Show 2-3 topics with formatted content

### Screenshot 3: Detailed View
- Expanded topics with Q&A sections
- Show rich formatting and comprehensive content
- Include download/export options if visible

### Screenshot 4: Options Page
- Clean settings interface
- API key setup area (blur/hide actual key)
- Professional layout and typography

### Screenshot 5: Export Features
- Download dialog or exported content preview
- Multiple format options visible
- Professional document styling

## ⚠️ Common Mistakes to Avoid

1. **Wrong Aspect Ratio**: Don't stretch images awkwardly
2. **Too Small Resolution**: Avoid upscaling low-res images
3. **Alpha Channel**: Remove transparency from PNGs
4. **File Size**: Keep under 16MB (usually not an issue)
5. **Content Quality**: Ensure screenshots show real functionality

## 🔍 Verification Checklist

Before uploading to Chrome Web Store:
- [ ] Exactly 1280x800 pixels
- [ ] PNG format (24-bit, no alpha) or JPEG
- [ ] File size under 16MB
- [ ] Clear, professional content
- [ ] Shows actual extension functionality
- [ ] No sensitive information visible (API keys, personal data)

## 🚀 Quick Fix Commands

If you have screenshots that need resizing:

```bash
# Navigate to screenshots folder
cd /Users/Aditya.Soni/VSCodeProjects/youtube-summarizer-general/screenshots

# Resize all PNG files to exact Chrome Web Store requirements
for file in *.png; do
    sips -z 800 1280 "$file" --out "fixed-$file"
done
```

The Chrome Web Store is very strict about these dimensions - they must be exactly 1280x800 pixels!

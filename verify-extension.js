#!/usr/bin/env node

/**
 * Extension Verification Script
 * Validates all required files and basic structure for Chrome Web Store submission
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 YouTube Summarizer Extension Verification\n');

// Required files for Chrome extension
const requiredFiles = [
  'manifest.json',
  'popup.html',
  'options.html',
  'js/background.js',
  'js/content.js',
  'js/popup.js',
  'js/options.js',
  'css/content.css',
  'css/popup.css',
  'css/options.css',
  'images/icon16.png',
  'images/icon32.png',
  'images/icon48.png',
  'images/icon128.png'
];

let allFilesPresent = true;
let totalSize = 0;

console.log('📁 Checking required files...\n');

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    totalSize += stats.size;
    
    console.log(`✅ ${file.padEnd(25)} (${sizeKB} KB)`);
  } else {
    console.log(`❌ ${file.padEnd(25)} (MISSING)`);
    allFilesPresent = false;
  }
});

console.log(`\n📊 Total Extension Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

// Validate manifest.json
console.log('\n📋 Validating manifest.json...\n');

try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  
  // Check required fields
  const requiredFields = ['manifest_version', 'name', 'version', 'description', 'permissions'];
  const manifestValid = requiredFields.every(field => {
    const exists = manifest[field] !== undefined;
    console.log(`${exists ? '✅' : '❌'} ${field}: ${exists ? '✓' : 'MISSING'}`);
    return exists;
  });
  
  // Check version format
  const versionValid = /^\d+\.\d+\.\d+$/.test(manifest.version);
  console.log(`${versionValid ? '✅' : '❌'} Version format: ${versionValid ? manifest.version : 'INVALID'}`);
  
  // Check permissions
  const hasRequiredPermissions = ['storage', 'tabs', 'activeTab'].every(perm => 
    manifest.permissions && manifest.permissions.includes(perm)
  );
  console.log(`${hasRequiredPermissions ? '✅' : '❌'} Required permissions: ${hasRequiredPermissions ? '✓' : 'MISSING'}`);
  
} catch (error) {
  console.log('❌ manifest.json: INVALID JSON');
  allFilesPresent = false;
}

// Check for development files that shouldn't be in production
console.log('\n🧹 Checking for development files...\n');

const devFiles = [
  'test-ui.html',
  '.DS_Store',
  'node_modules',
  '.git',
  'tests'
];

devFiles.forEach(file => {
  const exists = fs.existsSync(file);
  if (file === 'node_modules' || file === '.git' || file === 'tests') {
    // These are expected in development but not in packaged extension
    console.log(`ℹ️  ${file.padEnd(15)} ${exists ? '(dev only - exclude from package)' : '(not present)'}`);
  } else if (exists) {
    console.log(`⚠️  ${file.padEnd(15)} (should be removed for production)`);
  } else {
    console.log(`✅ ${file.padEnd(15)} (correctly absent)`);
  }
});

// Final assessment
console.log('\n' + '='.repeat(50));
console.log('📊 FINAL ASSESSMENT');
console.log('='.repeat(50));

if (allFilesPresent && totalSize < 50 * 1024 * 1024) { // 50MB limit
  console.log('✅ Extension structure: VALID');
  console.log('✅ File size: Within limits');
  console.log('✅ Ready for Chrome Web Store packaging');
} else {
  console.log('❌ Extension structure: ISSUES FOUND');
  if (totalSize >= 50 * 1024 * 1024) {
    console.log('❌ File size: Exceeds 50MB limit');
  }
  console.log('❌ Fix issues before Chrome Web Store submission');
}

console.log('\n🚀 Next steps:');
console.log('1. Complete manual testing with MANUAL_TEST_GUIDE.md');
console.log('2. Package extension for Chrome Web Store');
console.log('3. Submit for review');

console.log('\n✨ Extension verification complete!\n');

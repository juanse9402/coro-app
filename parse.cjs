const xlsx = require('xlsx');

// Load the workbook
const workbook = xlsx.readFile('../Cancionero Completo.xlsx');

// Get the first sheet
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = xlsx.utils.sheet_to_json(sheet);

console.log(JSON.stringify(data.slice(0, 3), null, 2));

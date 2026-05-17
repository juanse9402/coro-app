const xlsx = require('xlsx');
const fs = require('fs');

const workbook = xlsx.readFile('../Cancionero Completo.xlsx');
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Use sheet_to_json with header: 1 to get a 2D array of cells
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const songs = [];
let idCounter = 1;

rows.forEach(row => {
  row.forEach(cell => {
    if (typeof cell === 'string' && cell.trim().length > 0) {
      const lines = cell.split('\n');
      const titleLine = lines[0].trim();
      
      // If it looks like a title (e.g. "A1 - ALZA TUS OJOS Y MIRA" or just text)
      // Usually, the first line is the title.
      // We will extract title and content
      const title = titleLine;
      const content = lines.slice(1).join('\n');
      
      songs.push({
        id: idCounter++,
        title: title,
        artist: 'Desconocido', // Since it's not clearly defined in the excel
        content: cell, // Keep full cell content for display
        bpm: 100 // default mock BPM
      });
    }
  });
});

fs.writeFileSync('./public/canciones.json', JSON.stringify(songs, null, 2));
console.log(`Parsed ${songs.length} songs.`);

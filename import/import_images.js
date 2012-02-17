var mysql = require('mysql');
var inspect = require('util').inspect;
var async = require('async');
var fs = require('fs');

var db = mysql.createClient({
  user: "root",
  database: "madeiranature2"
});

function getExtension(type) {
  switch(type) {
    case 'image/jpeg':
    case 'image/pjpeg':
      return 'jpg';
    default:
      return 'bin'
  }
}

function saveFile(file, next) {
  fs.writeFile(__dirname + '/files/' + file.id + '.' + getExtension(file.type), file.content, next);
}

(function getAllFiles() {
  db.query([
    "SELECT id FROM act2_media_files"
  ].join(' '), [], function(err, results) {
    async.forEach(results, function(file, next) {
      db.query('SELECT * from act2_media_files WHERE id = ?', [file.id], function(err, file) {
        if (Array.isArray(file)) { file = file[0]; }
        console.log('file:', file.id);
        saveFile(file, next);
      });
    }, function(err) {
      if (err) { throw err; }
      console.log('done');
      db.end();
    });
  });
}());
var mysql = require('mysql');
var inspect = require('util').inspect;
var async = require('async');
var fs = require('fs');
var gm = require('gm');
var path = require('path');
var Iconv = require('iconv').Iconv;
var iconv = new Iconv('UTF-8', 'ISO-8859-1//TRANSLIT//IGNORE');

var db = mysql.createClient({
  user: "root",
  database: "madeiranature2"
});

function getExtension(type) {
  switch(type) {
    case 'image/jpeg':
    case 'image/pjpeg':
      return '.jpg';
    default:
      return '.bin'
  }
}

function convertFileName(fileName) {
  return iconv.convert(fileName).toString().replace(/ /g, '_');
}

function canonicalFilePath(file) {
  var fileName = convertFileName(file.name);
  var extension = path.extname(fileName) || getExtension(file.type);
  var filePathComponents = [__dirname, 'files', file.id + '-' + path.basename(fileName) + extension];
  return filePathComponents.join('/');
}

function saveFile(file, next) {
  fs.writeFile(canonicalFilePath(file), file.content, next);
}

function generateAllSizes(file, next) {
  function resize(width, height, next) {
    var fileName = convertFileName(file.name);
    var extension = path.extname(fileName) || getExtension(file.type);
    var newFileName = file.id + '-' + path.basename(fileName) + '-' + width + 'x' + height + extension;
    gm(canonicalFilePath(file))
      .resize(width, height)
      .write(__dirname + '/files/' + newFileName, next);
  }
  
  async.parallel([
    function(next) { resize(150, 150, next); },
    function(next) { resize(300, 300, next); },
    function(next) { resize(612, 288, next); },
    function(next) { resize(612, 288, next); },
  ], next);

}

(function getAllFiles() {
  db.query([
    "SELECT id FROM act2_media_files"
  ].join(' '), [], function(err, results) {
    async.forEachLimit(results, 10, function(file, next) {
      db.query('SELECT * from act2_media_files WHERE id = ?', [file.id], function(err, file) {
        if (Array.isArray(file)) { file = file[0]; }
        console.log('file:', file.id);
        saveFile(file, function(err) {
          if (err) { return next(err); }
          generateAllSizes(file, function(err) {
            if (err) { console.log('error converting file', file, err); }
            next();
          });
        });
      });
    }, function(err) {
      if (err) { throw err; }
      console.log('done');
      db.end();
    });
  });
}());
var mysql = require('mysql');
var inspect = require('util').inspect;
var async = require('async');
var slug = require('slug');
var Iconv = require('iconv').Iconv;
var iconv = new Iconv('UTF-8', 'ISO-8859-1');

var language = 'pt';

var db = mysql.createClient({
  user: "root",
  database: "madeiranature2"
});

var wpdb = mysql.createClient({
  user: "root",
  database: "madeiranaturewp"
});


function getPageStructure(callback) {
  var pages = [];
  var pending = 1;
  var visitedIds = {};
  
  function getTranslationsForPage(pageId, callback) {
    db.query([
      "select property, body from act2_translations",
      "where",
      "act2_translations.model = 'CmsPage'",
      "AND",
      "external_id = ?",
      "AND",
      "act2_translations.language = ?",
    ].join(' '), [pageId,language], function(err, results) {
      var props = {};
      if (err) { return callback(err); }
      results.forEach(function(translation) {
        props[translation.property] = iconv.convert(translation.body).toString();
      });
      return callback(null, props);
    });
  }
  
  function getAllByParentId(root, parentId) {
    db.query([
      "select act2_cms_pages.id, act2_cms_pages.parent_id, act2_cms_pages.sequence",
      "from act2_cms_pages",
      "where",
      "act2_cms_pages.parent_id = ?"
    ].join(' '), [parentId], function(err, results) {
      pending -= 1;
      if (err) { throw err; }
      async.forEach(results, function(page, next) {
        if (page.id in visitedIds) { return; }
        visitedIds[page.id] = true;

        pending += 1;
        
        var newPage = {
          id: page.id,
          children: [],
          title: page.body
        };
        
        getTranslationsForPage(newPage.id, function(err, props) {
          if (err) { return next(err); }
          for (var pr in props) { newPage[pr] = props[pr]; }
          root.push(newPage);
          getAllByParentId(newPage.children, newPage.id);
        });
        
      }, function(err) {
        if (err) { return callback(err); }
        
        if (! pending) { return callback(pages); }
      });

    });
  }
  
  getAllByParentId(pages, 0);
}

function importPage(parentId, parentSlug, page, done) {
  console.error('about to import page', page.label);
  var _slug = parentSlug + ' ' + page.label;
  wpdb.query([
    "INSERT INTO wp_terms(name, slug, term_group)",
    "VALUES (?, ?, ?)"
  ].join(' '), [page.label, slug(_slug).toLowerCase(), 0], function(err, result) {
    if (err) { return done(err); }
    var termId = result.insertId;
    wpdb.query([
      "INSERT INTO wp_term_taxonomy(term_id, taxonomy, description, parent, count)",
      "VALUES (?, ?, ?, ?, ?)"
    ].join(' '), [termId, 'category', page.title, parentId, 0], function(err, result) {
      if (err) { return done(err); }
      if (page.children.length === 0) { return done(); }
      async.forEach(page.children, function(childPage, next) {
        importPage(termId, _slug, childPage, next);
      }, done);
    });
  });
}

getPageStructure(function(pages) {
  console.log('pages:', inspect(pages, true, null));
  db.end();
  async.forEach(pages, function(page, next) {
    importPage(0, '', page, next);
  }, function(err) {
    if (err) { throw err; }
    console.log('done');
    wpdb.end();
  });
});


// db.query(
//   [
//     "select *" 
//     "from act2_cms_articles, " +
//   ].join(' ')
// );
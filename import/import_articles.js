var mysql = require('mysql');
var inspect = require('util').inspect;
var async = require('async');
var slug = require('slug');
var Iconv = require('iconv').Iconv;
var iconv = new Iconv('UTF-8', 'ISO-8859-1//TRANSLIT//IGNORE');

var language = 'pt';
DEFAULT_AUTHOR_ID = 1;

var db = mysql.createClient({
  user: "root",
  database: "madeiranature2"
});

var wpdb = mysql.createClient({
  user: "root",
  database: "madeiranaturewp"
});

function articleContent(article) {
  return article.body;
}

function insertArticle(article, done) {
  wpdb.query([
    "INSERT INTO wp_posts(post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_name, post_modified, post_modified_gmt, post_type, comment_count)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(' '), [DEFAULT_AUTHOR_ID, article.created, article.created, articleContent(article), article.title , article.intro, 'publish', 'closed', 'open', slug(article.title), article.modified, article.modified, 'post', 0], function(err, res) {
    if (err) { return done(err); }
    var postId = res.insertId;
    
    if (! article.themes.length) { return done(); }
    
    async.forEach(article.themes, function(theme, next) {
      wpdb.query([
        "INSERT INTO wp_term_relationships(object_id, term_taxonomy_id, term_order)",
        "VALUES (?, ?, ?)"
      ].join(' '), [postId, theme.id, 0], function(err) {
        if (err) { return next(err); }
        wpdb.query([
          "UPDATE wp_term_taxonomy",
          "SET count = count + 1",
          "WHERE term_taxonomy_id = ?"
        ].join(' '), [theme.id], next);
      });
      
    }, done);
    
  });
}

(function getArticles(next) {
  
  var articles = [];
  
  function getTranslationsForArticle(articleId, callback) {

    db.query([
      "select property, body from act2_translations",
      "where",
      "act2_translations.model = 'CmsArticle'",
      "AND",
      "external_id = ?",
      "AND",
      "act2_translations.language = ?",
    ].join(' '), [articleId,language], function(err, results) {
      var props = {};
      if (err) { return callback(err); }
      results.forEach(function(translation) {
        props[translation.property] = iconv.convert(translation.body).toString();
      });
      return callback(null, props);
    });
  }
  
  function getCategoriesForArticle(article, done) {
    db.query([
      "SELECT act2_translations.body",
      "FROM act2_cms_article_theme_cms_articles, act2_cms_article_themes, act2_cms_pages, act2_translations",
      "WHERE",
      "act2_cms_article_theme_cms_articles.cms_article_theme_id = act2_cms_article_themes.id",
      "AND",
      "act2_cms_article_theme_cms_articles.cms_article_id = ?",
      "AND",
      "act2_cms_pages.id = act2_cms_article_themes.cms_page_id",
      "AND",
      "act2_translations.model = 'CmsPage'",
      "AND",
      "act2_translations.property = 'title'",
      "AND",
      "act2_translations.external_id = act2_cms_pages.id",
    ].join(' '), [article.id], function(err, results) {
      //var categories = results.map(function(res) 
      if (err) { return done(err); }
      var categories = results
                        .filter(function(o) { return o.body.length > 0; })
                        .map(function(res) { return db.escape(iconv.convert(res.body).toString()); })
                        ;

      console.error('categories:', categories);
      if (categories.length === 0) {
        return done(null, []);
      }
      wpdb.query([
        "SELECT term_taxonomy_id as id, description",
        "FROM wp_term_taxonomy",
        "WHERE",
        "taxonomy = 'category'",
        "AND",
        "description in (" + categories.join(',') + ")"
      ].join(' '), [], function(err, res) {
        if (err) { return done(err); }
        if (res.length < 1) {
          return done(new Error('Couldn\'t find a taxonomy for ' + inspect(categories)));
        }
        console.error('categories for article %s: %j', article.title , res);
        done(null, res);
      });
    });
  }
  
  function getExtension(type) {
    switch(type) {
      case 'image/jpeg':
      case 'image/pjpeg':
        return 'jpg';
      default:
        return 'bin'
    }
  }
  
  function getArticleImages(article, next) {
    
    function getMainImage(article, next) {

      if (! article.overview_image_file_id) { return next(); }

      db.query([
        "SELECT *",
        "FROM act2_media_files",
        "WHERE id = ?"
      ].join(' '), [article.overview_image_file_id], function(err, res) {
        if (err) { return next(err); }
        var extension = getExtension(res.type);
        var filePath = '/file/' + res.id + '.' + extension;
        fs.writeFile(__dirname + '/' + filePath, res.content, function(err) {
          if (err) { return next(err); }
          article.mainImage = filePath;
          return next(null);
        });
      });
      
    }
    
    function getGalleryImages(article, next) {
      if (! article.article.image_gallery_id) { return next(); }
      db.query([
        "SELECT act2_media_files.*",
        "FROM act2_gallery_images, act2_media_files",
        "WHERE act2_gallery_images.id = ?",
        "AND",
        "act2_media_files.gallery_id = act2_gallery_images.image_file_id"
      ].join(' '), [article.image_gallery_id], function(err, res) {
        if (err) { return next(err); }
        if (! Array.isArray(res)) { res = [res]; }
        async.forEach(res, function(image, next) {
          var extension = getExtension(image.type);
          var filePath = '/file/' + image.id + '.' + extension;
          fs.writeFile(__dirname + '/' + filePath, image.content, function(err) {
            if (err) { return next(err) }
            if (! article.images) { article.images = []};
            article.images.push(filePath);
            next();
          });
        }, next);
      });
    }
    
    
    getMainImage(article, function(err) {
      if (err) { return next(err); }
      getGalleryImages(article, next);
    });
    
  }
  
  (function getArticles(done) {
    db.query([
      "select * from act2_cms_articles",
      "where active = 1"
    ].join(' '), function(err, results) {
      if (err) { return done(err); }
      async.forEach(results, function(article, next) {
        getTranslationsForArticle(article.id, function(err, props) {
          if (err) { return next(err); }
          for (prop in props) { article[prop] = props[prop]; }
          console.error('going to get themes for article', article.title);
          getCategoriesForArticle(article, function(err, themes) {
            if (err) { return next(err); }
            article.themes = themes;
            
            getArticleImages(article, function(err) {
              if (err) { return next(err); }
              articles.push(article);
              next();
            });
            
          });
        });
      }, function(err) {
        if (err) { return done(err); }
        done(null, articles);
      });
    });
  }(next));
  
}(function(err, articles) {
  if (err) { throw err; }
  db.end();
  console.log('done:', inspect(articles, false, null));
  console.log('going to insert %d articles', articles.length);
  var inserted = 0;
  async.forEach(articles, function(article, next) {
    insertArticle(article, function(err) {
      if (err) { return next(err);}
      inserted += 1;
      console.log('inserted %d articles', inserted);
      return next();
    });
  }, function(err) {
    if (err) { throw err; }
    wpdb.end();
  });
}));
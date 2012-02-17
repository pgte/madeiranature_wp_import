var mysql = require('mysql');
var inspect = require('util').inspect;
var async = require('async');
var slug = require('slug');
var Iconv = require('iconv').Iconv;
var iconv = new Iconv('UTF-8', 'ISO-8859-1//TRANSLIT//IGNORE');
var path = require('path');

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
  return article.body + ' [gallery]';
}

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
  if (! fileName) { return '';}
  return iconv.convert(fileName).toString().replace(/ /g, '_');
}

function canonicalImagePath(file) {
  var fileName = convertFileName(file.name);
  var extension = path.extname(fileName) || getExtension(file.type);
  return file.id + '-' + path.basename(fileName) + extension;
}

function resizedImagePath(file, width, height) {
  var fileName = convertFileName(file.name);
  var extension = path.extname(fileName) || getExtension(file.type);
  return file.id + '-' + path.basename(fileName) + '-' + width + 'x' + height + extension;
}

function generateMetadata(file) {
  console.log('generate meta data for ', file);
  return 'a:6:{s:5:"width";s:3:"612";s:6:"height";s:3:"612";s:14:"hwstring_small";s:22:"height=\'96\' width=\'96\'";s:4:"file";s:46:"' + canonicalImagePath(file) +
  '";s:5:"sizes";a:5:{s:9:"thumbnail";a:3:{s:4:"file";s:46:"'+resizedImagePath(file, 150, 150)+
  '";s:5:"width";s:3:"150";s:6:"height";s:3:"150";}s:6:"medium";a:3:{s:4:"file";s:46:"'+resizedImagePath(file, 300, 300) +
  '";s:5:"width";s:3:"300";s:6:"height";s:3:"300";}s:14:"post-thumbnail";a:3:{s:4:"file";s:46:"' + resizedImagePath(file, 612, 288) +
  '";s:5:"width";s:3:"612";s:6:"height";s:3:"288";}s:13:"large-feature";a:3:{s:4:"file";s:46:"' + resizedImagePath(file, 612, 288) +
  '";s:5:"width";s:3:"612";s:6:"height";s:3:"288";}s:13:"small-feature";a:3:{s:4:"file";s:46:"'+ resizedImagePath(file, 300, 300) +
  '";s:5:"width";s:3:"300";s:6:"height";s:3:"300";}}s:10:"image_meta";a:10:{s:8:"aperture";s:1:"0";s:6:"credit";s:0:"";s:6:"camera";s:0:"";s:7:"caption";s:0:"";s:17:"created_timestamp";s:1:"0";s:9:"copyright";s:0:"";s:12:"focal_length";s:1:"0";s:3:"iso";s:1:"0";s:13:"shutter_speed";s:1:"0";s:5:"title";s:0:"";}}'
}

function insertArticleImage(article, image, next) {
  wpdb.query([
    "INSERT INTO wp_posts (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_name, post_modified, post_modified_gmt, post_parent, post_mime_type, post_type, comment_count)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(' '), [DEFAULT_AUTHOR_ID, article.created, article.created, '', canonicalImagePath(image) , '', 'inherit', 'closed', 'open', canonicalImagePath(image), article.modified, article.modified, article.wp_post_id, image.type, 'attachment', 0], function(err, res) {
    if (err) { return next(err); }
    var imagePostId = res.insertId;
    wpdb.query([
      "INSERT INTO wp_postmeta(post_id, meta_key, meta_value)",
      "VALUES (?, ?, ?)"
    ].join(' '), [res.insertId, '_wp_attached_file', canonicalImagePath(image)], function(err) {
      if (err) { return next(err); }
      wpdb.query([
        "INSERT INTO wp_postmeta(post_id, meta_key, meta_value)",
        "VALUES (?, ?, ?)"
      ].join(' '), [article.wp_post_id, '_wp_attachment_metadata', generateMetadata(image)], function(err) {
        if (err) { return next(err); }
        return next(null, imagePostId);
      });
      
    });
  });
}

function insertArticleImages(article, next) {
  console.log('going to insert article images');
  async.forEach(article.images || [], function(image, next) {
    console.log('image:', image);
    return insertArticleImage(article, image, next);
  }, next);
}

function insertArticleMainImage(article, next) {
  if (article.mainImage) {
    insertArticleImage(article, article.mainImage, function(err, imagePostId) {
      if (err) { return next(err); }
      wpdb.query(['INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES(?, ?, ?)'].join(' '),
      [article.wp_post_id, '_thumbnail_id', imagePostId], next);
    });
  } else {
    return next();
  }
}

function insertArticle(article, done) {
  console.log('going to insert article:', article);
  wpdb.query([
    "INSERT INTO wp_posts(post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_name, post_modified, post_modified_gmt, post_type, comment_count)",
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ].join(' '), [DEFAULT_AUTHOR_ID, article.created, article.created, articleContent(article), article.title , article.intro, 'publish', 'closed', 'open', slug(article.title), article.modified, article.modified, 'post', 0], function(err, res) {
    if (err) { return done(err); }
    var postId = res.insertId;
    
    article.wp_post_id = postId;
    
    insertArticleMainImage(article, function(err) {
      if (err) { return done(err); }
      insertArticleImages(article, function(err) {
        if (err) { return done(err); }

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
    });
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
        done(null, res);
      });
    });
  }
  
  function getArticleImages(article, next) {
    
    function getMainImage(article, next) {
      if (! article.overview_image_file_id) { return next(); }
      db.query([
        "SELECT act2_media_files.id, act2_media_files.type, act2_media_files.name",
        "FROM act2_media_files",
        "WHERE act2_media_files.id = ?",
      ].join(' '), [article.overview_image_file_id], function(err, file) {
        if (err) { return next(err); }
        if (Array.isArray(file)) { file = file[0]; };
        if (! file) { return next(); }
        article.mainImage = file;
        console.log('main image:', file);
        return next();
      });
    }
    
    function getGalleryImages(article, next) {
      if (! article.image_gallery_id) { return next(); }
      db.query([
        "SELECT act2_media_files.id, act2_media_files.type, act2_media_files.name",
        "FROM act2_gallery_images, act2_media_files",
        "WHERE act2_gallery_images.gallery_id = ?",
        "AND act2_gallery_images.image_file_id = act2_media_files.id"
      ].join(' '), [article.image_gallery_id], function(err, res) {
        if (err) { return next(err); }
        if (! Array.isArray(res)) { res = [res]; }
        async.forEach(res, function(image, next) {
          if (! article.images) { article.images = []};
          article.images.push(image);
          console.log('images for article id %d, %j', article.id, image);
          next();
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
  var inserted = 0;
  // insertArticle(articles.filter(function(a) { return a.id === 6; })[0], function(err) {
  //   if (err) { throw err; }
  //   console.log('done');
  // });
  // return;
  
  console.log('going to insert %d articles', articles.length);
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
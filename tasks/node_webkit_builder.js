/*
 * grunt-node-webkit-builder
 * https://github.com/mllrsohn/grunt-node-webkit-builder
 *
 * Copyright (c) 2013 Steffen Müller
 * Copyright (c) 2013 Jens Alexander Ewald
 * Licensed under the MIT license.
 */

var Q = require('q'),
  path = require('path'),
  fs = require('fs'),
  path = require('path'),
  async = require('async');

module.exports = function(grunt) {
  // ***************************************************************************
  // Configure the task:
  grunt.registerMultiTask(
    'nodewebkit',
    'Packaging the current app as a node-webkit application',
    function() {

    var compress = require('./lib/compress')(grunt),
        download = require('./lib/download')(grunt),
        utils = require('./lib/utils')(grunt);

    var self = this,
      done = this.async(), // This is async so make sure we initalize done
      _ = grunt.util._,
      package_path = false,
      downloadDone = [],
      options = this.options({
          version: '0.7.5',
          app_name: null,
          app_version: null,
          build_dir: null, // Path where
          force_download: false,
          win: false,
          mac: false,
          linux32: false,
          linux64: false,
          download_url: 'https://s3.amazonaws.com/node-webkit/',
          timestamped_builds: false,
          credits: false,
          keep_nw: false
      }),
      webkitFiles = [{
        'url': "v%VERSION%/node-webkit-v%VERSION%-win-ia32.zip",
        'type': 'win',
        'files': ['ffmpegsumo.dll', 'icudt.dll', 'libEGL.dll', 'libGLESv2.dll', 'nw.exe', 'nw.pak'],
        'nwpath': 'nw.exe',
        'app': '%APPNAME%.exe',
        'exclude': ['nwsnapshot.exe']
      }, {
        'url': "v%VERSION%/node-webkit-v%VERSION%-osx-ia32.zip",
        'type': 'mac',
        'files': ['node-webkit.app'],
        'nwpath': '%APPNAME%.app/Contents/Resources',
        'app': 'app.nw', // We have to keep the name as "app.nw" on OS X!
        'exclude': ['nwsnapshot']
      }, {
        'url': "v%VERSION%/node-webkit-v%VERSION%-linux-ia32.tar.gz",
        'type': 'linux32',
        'files': ['nw', 'nw.pak', 'libffmpegsumo.so'],
        'nwpath': 'nw',
        'app': '%APPNAME%',
        'exclude': ['nwsnapshot']
      }, {
        'url': "v%VERSION%/node-webkit-v%VERSION%-linux-x64.tar.gz",
        'type': 'linux64',
        'files': ['nw', 'nw.pak', 'libffmpegsumo.so'],
        'nwpath': 'nw',
        'app': '%APPNAME%',
        'exclude': ['nwsnapshot']
      }];

    // ***************************************************************************
    // Verifying if we have all needed Config Options
    // And generate the release path and files

    // Check the target plattforms
    if (!_.any(_.pick(options,"win","mac","linux32","linux64"))) {
      grunt.log.warn("No platforms to build!");
      return done();
    }

    // Check if we need to get the AppName and AppVersion from the json or from the config
    var packageInfo = utils.getPackageInfo(this.files);
    if(!options.app_name || !options.app_version) {
      options.app_name = options.app_name || packageInfo.name;
      options.app_version = options.app_version || packageInfo.version;
    }

    // Generate the release path
    var release_path = path.resolve(
      options.build_dir,
      'releases',
      options.app_name + (options.timestamped_builds ?  ' - ' + Math.round(Date.now() / 1000).toString() : '')
    );

    // Get the Path for the releaseFile
    var releaseFile = path.resolve(
      release_path,
      options.app_name + '.nw'
    );

    // Make the release_path itself
    grunt.file.mkdir(release_path);

    // Compress the project into the release path
    downloadDone.push(compress.generateZip(this.files, releaseFile));

    // Download and unzip / untar the needed files
    webkitFiles.forEach(function(plattform) {
      if (options[plattform.type]) {
        plattform.url = options.download_url + plattform.url.split('%VERSION%').join(options.version);
        plattform.app = plattform.app.split('%APPNAME%').join(options.app_name);
        plattform.nwpath = plattform.nwpath.split('%APPNAME%').join(options.app_name);
        plattform.dest = path.resolve(
          options.build_dir,
          'cache',
          plattform.type,
          options.version
        );

        // If force is true we delete the path
        if (grunt.file.isDir(plattform.dest) && options.force_download) {
          grunt.file.delete(plattform.dest, {
            force: true
          });
        }

        // Download files
        downloadDone.push(download.downloadAndUnpack(plattform));
      }
    });

    // Download and zip creation done, let copy
    // the files and stream the zip into the files/folders
    Q.all(downloadDone).done(function(plattforms) {
      var zipFile = releaseFile,
        generateDone = [];

      plattforms.forEach(function(plattform) {
        var releaseDone = [],
          releaseFolder, releasePathApp;

        if (!plattform) {
          return false;
        }

        // Set the release folder
        releaseFolder  = path.resolve(
          release_path,
          plattform.type,
          (plattform.type !== 'mac' ? options.app_name : '')
        );

        releasePathApp = path.resolve(
          releaseFolder,
          (plattform.type === 'mac' ? plattform.nwpath : ''),
          plattform.app
        );

        // If plattform is mac, we just copy node-webkit.app
        // Otherwise we copy everything that is on the plattform.files array
        grunt.file.recurse(plattform.dest, function(abspath, rootdir, subdir, filename) {
          if (plattform.exclude.indexOf(filename)>=0) {
            return;
          }
          if (plattform.type === 'mac') {
            if(filename !== plattform.filename) {

              // Name the .app bundle on OS X correctly
              subdir = (subdir ? subdir.replace(/^node-webkit/,options.app_name) : subdir);
              subdir = (subdir ? subdir : '');
              var stats = fs.lstatSync(abspath);
              var target_filename = path.join(releaseFolder, subdir, filename);
              grunt.file.copy(abspath, target_filename);

              if (target_filename.match(options.app_name+'.app/Contents/Info.plist$')) {

                // Generate Info.plist$
                utils.generatePlist(target_filename, options, packageInfo);

                // Generate credits.html
                if(options.credits) {
                  if(!grunt.file.exists(options.credits)) {
                    grunt.log.warn("Your credits.html file does not exists in: ", options.credits);
                  } else {
                    grunt.file.copy(options.credits, path.resolve(path.dirname(target_filename),'Resources','Credits.html'));
                  }
                }
              }

              fs.chmodSync(target_filename, stats.mode);
              // TODO: edit the plist file according to config
            }
          } else if (plattform.files.indexOf(filename) >= 0) {
            // Omit the nw executable on other platforms
            if(filename !== 'nw.exe' && filename !== 'nw') {
              grunt.file.copy(abspath, path.join(releaseFolder, filename));
            }
          }
        });

        // Let's create the release
        generateDone.push(
          compress.generateRelease(
            releasePathApp,
            zipFile,
            plattform.type,
            (plattform.type !== 'mac' ? path.resolve(plattform.dest, plattform.nwpath) : null)
          )
        );
      });

      Q.all(generateDone).done(function(plattforms) {
        if(!options.keep_nw) {
          compress.cleanUpRelease(zipFile);
        }
        grunt.log.oklns('Created a new release with node-webkit ('+options.version+') for '+plattforms.join(', '));
        grunt.log.ok('@ ' + release_path);
        done();
      });

    });
  });
};

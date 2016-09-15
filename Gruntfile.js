'use strict';

module.exports = function (grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    browserify: {
      main: {
        options: {
          external: ['kevoree-library'],
          browserifyOptions: {
            standalone: 'KevoreeCore'
          }
        },
        src: ['<%= pkg.main %>'],
        dest: 'browser/<%= pkg.name %>.js'
      }
    },
    uglify: {
      browser: {
        files: {
          'browser/<%= pkg.name %>.js': 'browser/<%= pkg.name %>.js'
        }
      }
    },
  });

  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-contrib-uglify');

  grunt.registerTask('default', ['browserify', 'uglify']);
};

module.exports = function (grunt) {

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        browserify: {
            standalone: {
                options: {
                    browserifyOptions: {
                        standalone: 'KevoreeCore'
                    }
                },
                src: ['<%= pkg.main %>'],
                dest: 'browser/<%= pkg.name %>.js'
            },
            require: {
                options: {
                    alias: [ '<%= pkg.main %>:<%= pkg.name %>' ],
                    external: ['kevoree-model']
                },
                src: [],
                dest: 'browser/<%= pkg.name %>.require.js'
            }
        }
    });

    grunt.loadNpmTasks('grunt-browserify');

    grunt.registerTask('browser', 'browserify');
};
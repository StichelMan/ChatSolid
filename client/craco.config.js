const webpack = require('webpack');

module.exports = {
    webpack: {
        configure: (webpackConfig, { env, paths }) => {
            // Add an exclude rule for source maps
            webpackConfig.module.rules.push({
                test: /\.js$/,
                enforce: 'pre',
                use: ['source-map-loader'],
                exclude: /@inrupt\/src/,
            });

            webpackConfig.plugins = [
                ...webpackConfig.plugins,
                new webpack.ProvidePlugin({
                    process: 'process/browser',
                }),
            ];

            webpackConfig.resolve.fallback = {
                ...webpackConfig.resolve.fallback,
                buffer: require.resolve('buffer/'),
                process: require.resolve('process/browser'),
            };

            return webpackConfig;
        },
    },
};

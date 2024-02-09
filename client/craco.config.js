const webpack = require('webpack');

module.exports = {
    webpack: {
        configure: (webpackConfig, { env, paths }) => {
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

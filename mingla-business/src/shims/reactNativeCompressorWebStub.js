const passThrough = async (uri) => uri;

module.exports = {
  Audio: {
    compress: passThrough,
  },
  Image: {
    compress: passThrough,
  },
  Video: {
    compress: passThrough,
  },
};

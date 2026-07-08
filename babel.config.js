module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // babel-preset-expo (SDK 57) auto-adds react-native-worklets/plugin last
    // when reanimated 4 is installed, so no manual worklets plugin is needed.
  };
};

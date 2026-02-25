'use strict';
const TARGET_TRIPLE_MAP = {
  'darwin-x64':  'x86_64-apple-darwin',
  'darwin-arm64':'aarch64-apple-darwin',
  'linux-x64':   'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64':   'x86_64-pc-windows-msvc',
};
module.exports = { TARGET_TRIPLE_MAP };

const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");

// 本地更新依赖同名校验文件；每次构建安装包时自动生成，和安装包一起交付。
module.exports = async function afterArtifacts(context) {
  const checksums = [];
  for (const file of context.artifactPaths) {
    const filename = path.basename(file);
    if (!/^(?:NAI生图台|NAI-Image-Studio)-Setup-\d+\.\d+\.\d+\.exe$/.test(filename)) continue;
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    const sidecar = file + ".sha256";
    await fsp.writeFile(sidecar, `${hash.digest("hex")}  ${filename}\n`, "utf8");
    checksums.push(sidecar);
  }
  return checksums;
};

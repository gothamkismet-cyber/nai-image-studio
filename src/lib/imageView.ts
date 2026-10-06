export interface ImageSize { width: number; height: number }
export interface ImageView { scale: number; x: number; y: number }
export const MIN_IMAGE_SCALE = 0.01;
export const MAX_IMAGE_SCALE = 8;

export function fitImage(image: ImageSize, area: ImageSize): ImageView {
  const scale = Math.max(MIN_IMAGE_SCALE, Math.min(1, (area.width - 32) / image.width, (area.height - 32) / image.height));
  return { scale, x: 0, y: 0 };
}

export function boundImage(view: ImageView, image: ImageSize, area: ImageSize): ImageView {
  const scale = Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, view.scale));
  const dx = Math.max(0, (image.width * scale - area.width + 32) / 2);
  const dy = Math.max(0, (image.height * scale - area.height + 32) / 2);
  return { scale, x: Math.min(dx, Math.max(-dx, view.x)), y: Math.min(dy, Math.max(-dy, view.y)) };
}

/** 锚点相对查看区中心；缩放后尽量保持鼠标所指的画面位置。 */
export function zoomImage(view: ImageView, scale: number, image: ImageSize, area: ImageSize, anchor = { x: 0, y: 0 }): ImageView {
  const next = Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
  const ratio = next / view.scale;
  return boundImage({ scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, image, area);
}

/** 始终复制原图，查看区的缩放/平移不参与处理。 */
export async function copyImage(png: Blob): Promise<void> {
  if (png.type !== "image/png" || !png.size || png.size > 32 * 1024 * 1024) throw new Error("图片无法复制或超过 32 MB，请使用下载 PNG。");
  if (window.desktop?.copyImage) {
    const result = await window.desktop.copyImage(new Uint8Array(await png.arrayBuffer()));
    if (!result.ok) throw new Error(result.message || "复制失败，请重试或下载 PNG。");
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不支持复制图片，请使用下载 PNG，或在 HTTPS / 本机页面中打开。");
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]); }
  catch { throw new Error("未能写入剪贴板，请允许剪贴板权限后重试，或下载 PNG。"); }
}

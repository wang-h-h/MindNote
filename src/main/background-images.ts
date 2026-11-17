import { BrowserWindow, nativeImage, protocol } from 'electron';
import type { BackgroundImage } from '../shared/types';
import type { MindNoteStore } from './store';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const IMAGE_SCHEME = 'mindnote-image';
const MAX_BYTES = 20 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

export async function readBackgroundImage(file: string): Promise<BackgroundImage & { data: Buffer }> {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES)
    throw new Error('请选择不超过 20 MB 的 PNG、JPEG、GIF 或 WebP 图片。');
  const data = await readFile(file);
  if (data.length > MAX_BYTES) throw new Error('图片大小超过 20 MB。');
  let mimeType: BackgroundImage['mimeType'];
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mimeType = 'image/jpeg';
  else if (['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) mimeType = 'image/gif';
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
    mimeType = 'image/webp';
  else throw new Error('此文件不是支持的图片格式，请选择 PNG、JPEG、GIF 或 WebP。');
  // Decode in an isolated Chromium image document to verify dimensions and get
  // a real first frame for formats nativeImage does not decode on every OS.
  await decodeFirstFrame(data, mimeType, true);
  return { id: randomUUID(), name: path.basename(file).slice(0, 200), mimeType, data };
}

async function decodeFirstFrame(data: Buffer, mimeType: string, validateOnly = false): Promise<Buffer> {
  const quick = nativeImage.createFromBuffer(data);
  if (!quick.isEmpty()) {
    const size = quick.getSize();
    if (size.width * size.height > 40_000_000 || size.width > 16000 || size.height > 16000)
      throw new Error('图片尺寸过大，请缩小后重试。');
    return validateOnly ? Buffer.alloc(0) : quick.toPNG();
  }
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await window.loadURL(
      'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src data:">',
    );
    const result = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const img=new Image();const timer=setTimeout(()=>reject(new Error('图片解码超时')),5000);
      img.onload=()=>{clearTimeout(timer);if(img.naturalWidth*img.naturalHeight>40000000||img.naturalWidth>16000||img.naturalHeight>16000)return reject(new Error('图片尺寸过大'));
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);resolve(canvas.toDataURL('image/png').split(',')[1]);};
      img.onerror=()=>{clearTimeout(timer);reject(new Error('图片无法解码'))};img.src=${JSON.stringify(`data:${mimeType};base64,${data.toString('base64')}`)};
    })`);
    return validateOnly ? Buffer.alloc(0) : Buffer.from(result as string, 'base64');
  } finally {
    window.destroy();
  }
}

export function backgroundURL(store: MindNoteStore, id: unknown, still: unknown): string | null {
  if (typeof id !== 'string' || !ID.test(id) || (still !== undefined && typeof still !== 'boolean'))
    throw new Error('背景图片标识无效。');
  if (!store.getBackgroundImage(id)) return null;
  return `${IMAGE_SCHEME}://background/${id}${still ? '?still=1' : ''}`;
}

export function registerBackgroundProtocol(store: MindNoteStore): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    if (
      request.method !== 'GET' ||
      url.hostname !== 'background' ||
      !ID.test(id) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== 'still')
    )
      return new Response(null, { status: 404 });
    const asset = store.getBackgroundImage(id);
    if (!asset) return new Response(null, { status: 404 });
    try {
      const still =
        url.searchParams.get('still') === '1' && ['image/gif', 'image/webp'].includes(asset.mimeType);
      const data = still ? await decodeFirstFrame(asset.data, asset.mimeType) : asset.data;
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': still ? 'image/png' : asset.mimeType,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 422 });
    }
  });
}

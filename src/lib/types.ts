export type Kind = 'file' | 'dir'

export interface Entry {
  id: string
  name: string
  kind: Kind
  ext: string
  size: number
  mtime: number
  handle?: FileSystemFileHandle | FileSystemDirectoryHandle
  rel?: string
}

export type SortKey = 'name' | 'mtime' | 'size' | 'ext'
export type SortDir = 'asc' | 'desc'

export interface DirNode {
  name: string
  path: string
  handle: FileSystemDirectoryHandle
}

export const DESIGN_EXTS = new Set([
  'psd', 'psb', 'ai', 'indd', 'indt', 'eps', 'pdf', 'sketch', 'fig', 'xd',
  'cdr', 'afdesign', 'afphoto', 'svg',
])

export const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'ico',
  'tga', 'avif', 'heic', 'heif',
])

export const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv',
])

export const THREE_D_EXTS = new Set([
  'c4d', 'max', 'blend', 'skp', '3dm', 'rvt', 'dwg', 'fbx', 'obj', 'stl', 'glb', 'gltf', '3ds',
])

export const RAW_EXTS = new Set([
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2',
])

export function groupOf(ext: string): string {
  if (DESIGN_EXTS.has(ext)) return 'design'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (THREE_D_EXTS.has(ext)) return '3d'
  if (RAW_EXTS.has(ext)) return 'raw'
  return 'other'
}

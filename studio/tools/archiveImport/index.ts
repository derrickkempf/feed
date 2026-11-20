import type {Tool} from 'sanity'
import {UploadIcon} from '@sanity/icons/Upload'
import {ArchiveImportTool} from './ArchiveImportTool'

export const archiveImportTool: Tool = {
  name: 'archive-import',
  title: 'Archive import',
  icon: UploadIcon,
  component: ArchiveImportTool,
}

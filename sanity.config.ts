'use client'

import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {apiVersion, dataset, projectId} from './sanity/env'
import {schemaTypes, singletonTypes} from './sanity/schemaTypes'
import {structure} from './sanity/structure'
import {archiveImportTool} from './sanity/tools/archiveImport'

export default defineConfig({
  basePath: '/studio',
  name: 'derrick-kempf-art',
  title: 'Derrick Kempf — A Daily Record',
  projectId,
  dataset,
  schema: {
    types: schemaTypes,
    // Hide singletons from the "New document" menu
    templates: (templates) => templates.filter(({schemaType}) => !singletonTypes.has(schemaType)),
  },
  document: {
    actions: (input, {schemaType}) =>
      singletonTypes.has(schemaType)
        ? input.filter(({action}) => action && ['publish', 'discardChanges', 'restore'].includes(action))
        : input,
  },
  plugins: [structureTool({structure}), visionTool({defaultApiVersion: apiVersion})],
  tools: (prev) => [...prev, archiveImportTool],
})

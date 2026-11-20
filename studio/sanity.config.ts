import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes, singletonTypes} from './schemaTypes'
import {structure} from './structure'
import {archiveImportTool} from './tools/archiveImport'

export default defineConfig({
  name: 'default',
  title: 'Derrick Kempf art feed',

  projectId: 'ppc8ofpe',
  dataset: 'production',

  plugins: [structureTool({structure}), visionTool()],
  tools: (prev) => [...prev, archiveImportTool],

  schema: {
    types: schemaTypes,
    // Hide singletons (About, Site settings) from the "New document" menu
    templates: (templates) => templates.filter(({schemaType}) => !singletonTypes.has(schemaType)),
  },
  document: {
    actions: (input, {schemaType}) =>
      singletonTypes.has(schemaType)
        ? input.filter(({action}) => action && ['publish', 'discardChanges', 'restore'].includes(action))
        : input,
  },
})

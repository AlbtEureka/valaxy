/**
 * @packageDocumentation valaxy plugin
 */

import { join, relative, resolve } from 'pathe'
import fs from 'fs-extra'

import type { Plugin, ResolvedConfig } from 'vite'
import { defu } from 'defu'
import pascalCase from 'pascalcase'
import type { DefaultTheme, PageDataPayload, Pkg, SiteConfig } from 'valaxy/types'
import { dim, yellow } from 'picocolors'
import type { RouteRecordRaw } from 'vue-router'
import { defaultSiteConfig, mergeValaxyConfig, resolveSiteConfig, resolveUserThemeConfig } from '../config'
import type { ResolvedValaxyOptions, ValaxyServerOptions } from '../options'
import { processValaxyOptions, resolveOptions, resolveThemeValaxyConfig } from '../options'
import { resolveImportPath, toAtFS } from '../utils'
import { createMarkdownToVueRenderFn } from '../markdown/markdownToVue'
import type { ValaxyNodeConfig } from '../types'
import { checkMd } from '../markdown/check'
import { vLogger } from '../logger'
import { countPerformanceTime } from '../utils/performance'
import { isProd } from '../utils/env'

function generateConfig(options: ResolvedValaxyOptions) {
  const routes = options.redirects.map<RouteRecordRaw>((redirect) => {
    return {
      path: redirect.from,
      redirect: redirect.to,
    }
  })
  options.config.runtimeConfig.redirects = {
    useVueRouter: isProd() ? options.config.siteConfig.redirects!.useVueRouter! : true,
    redirectRoutes: routes,
  }

  return `export default ${JSON.stringify(JSON.stringify(options.config))}`
}

/**
 * for /@valaxyjs/styles
 * @param roots
 */
function generateStyles(roots: string[], options: ResolvedValaxyOptions) {
  const imports: string[] = []

  // katex
  if (options.config.features?.katex) {
    imports.push(`import "${toAtFS(resolveImportPath('katex/dist/katex.min.css', true))}"`)
    imports.push(`import "${toAtFS(join(options.clientRoot, 'styles/third/katex.scss'))}"`)
  }

  for (const root of roots) {
    const styles: string[] = []

    const autoloadNames = ['index', 'css-vars']
    autoloadNames.forEach((name) => {
      styles.push(join(root, 'styles', `${name}.css`))
      styles.push(join(root, 'styles', `${name}.scss`))
    })

    for (const style of styles) {
      if (fs.existsSync(style))
        imports.push(`import "${toAtFS(style)}"`)
    }
  }

  return imports.join('\n')
}

function generateLocales(roots: string[]) {
  const imports: string[] = [
    'import { defu } from "defu"',
    'const messages = { "zh-CN": {}, en: {} }',
  ]
  const languages = ['zh-CN', 'en']

  roots.forEach((root, i) => {
    languages.forEach((lang) => {
      const langYml = `${root}/locales/${lang}.yml`
      if (fs.existsSync(langYml) && fs.readFileSync(langYml, 'utf-8')) {
        const varName = lang.replace('-', '') + i
        imports.unshift(`import ${varName} from "${toAtFS(langYml)}"`)
        // pre override next
        imports.push(`messages['${lang}'] = defu(${varName}, messages['${lang}'])`)
      }
    })
  })

  imports.push('export default messages')
  return imports.join('\n')
}

function generateAddons(options: ResolvedValaxyOptions) {
  const globalAddonComponents = options.addons
    .filter(v => v.global)
    .filter(v => fs.existsSync(join(v.root, './App.vue')))
  const spliceImportName = (str: string) => `Addon${pascalCase(str)}App`

  const imports = globalAddonComponents
    .map(addon => `import ${spliceImportName(addon.name)} from "${addon.name}/App.vue"`)
    .join('\n')

  const components = globalAddonComponents
    .map(addon => `{ component: ${spliceImportName(addon.name)}, props: ${JSON.stringify(addon.props)} }`)
    .join(',')

  return `${imports}\n` + `export default [${components}]`
}

/**
 * vue component render null
 */
const nullVue = 'import { defineComponent } from "vue"; export default defineComponent({ render: () => null });'

/**
 * generate app vue from root/app.vue
 * @param root
 */
function generateAppVue(root: string) {
  const appVue = join(root, 'App.vue')
  if (!fs.existsSync(appVue))
    return nullVue

  const scripts = [
      `import AppVue from "${toAtFS(appVue)}"`,
      'export default AppVue',
  ]

  return scripts.join('\n')
}

/**
 * create valaxy plugin (virtual modules)
 * @internal
 * @param options
 * @param serverOptions
 */
export function createValaxyPlugin(options: ResolvedValaxyOptions, serverOptions: ValaxyServerOptions = {}): Plugin {
  let { config: valaxyConfig } = options

  const valaxyPrefix = '/@valaxy'

  const roots = options.roots

  let markdownToVue: Awaited<ReturnType<typeof createMarkdownToVueRenderFn>>
  let hasDeadLinks = false
  let viteConfig: ResolvedConfig

  return {
    name: 'valaxy:loader',
    enforce: 'pre',

    async configResolved(resolvedConfig) {
      viteConfig = resolvedConfig
      markdownToVue = await createMarkdownToVueRenderFn(
        options,
        options.userRoot,
        options.pages,
        viteConfig.define,
        viteConfig.command === 'build',
        options.config.siteConfig.lastUpdated,
      )
    },

    configureServer(server) {
      server.watcher.add([
        options.configFile,
        options.clientRoot,
        options.themeRoot,
        options.userRoot,
      ])
    },

    resolveId(id) {
      if (id.startsWith(valaxyPrefix))
        return id
      return null
    },

    load(id) {
      if (id === '/@valaxyjs/config')
        // stringify twice for \"
        return generateConfig(options)

      if (id === '/@valaxyjs/context') {
        return `export default ${JSON.stringify(JSON.stringify({
          userRoot: options.userRoot,
          // clientRoot: options.clientRoot,
        }))}`
      }

      // generate styles
      if (id === '/@valaxyjs/styles')
        return generateStyles(roots, options)

      if (id === '/@valaxyjs/locales')
        return generateLocales(roots)

      if (id === '/@valaxyjs/addons')
        return generateAddons(options)

      if (id === '/@valaxyjs/UserAppVue')
        return generateAppVue(options.userRoot)

      if (id === '/@valaxyjs/ThemeAppVue')
        return generateAppVue(options.themeRoot)

      if (id.startsWith(valaxyPrefix)) {
        return {
          code: '',
          map: { mappings: '' },
        }
      }
    },

    async transform(code, id) {
      if (id.endsWith('.md')) {
        checkMd(code, id)
        code.replace('{%', '\{\%')
        code.replace('%}', '\%\}')

        // transform .md files into vueSrc so plugin-vue can handle it
        const { vueSrc, deadLinks, includes } = await markdownToVue(
          code,
          id,
          viteConfig.publicDir,
        )
        if (deadLinks.length)
          hasDeadLinks = true

        if (includes.length) {
          includes.forEach((i) => {
            this.addWatchFile(i)
          })
        }

        return vueSrc
      }
    },

    renderStart() {
      if (hasDeadLinks && !valaxyConfig.ignoreDeadLinks)
        throw new Error('One or more pages contain dead links.')
    },

    /**
     * handle config hmr
     * @param ctx
     */
    async handleHotUpdate(ctx) {
      const endCount = countPerformanceTime()
      const { file, server, read } = ctx

      const reloadConfigAndEntries = (config: ValaxyNodeConfig) => {
        serverOptions.onConfigReload?.(config, options.config)
        Object.assign(options.config, config)

        valaxyConfig = config

        const moduleIds = ['/@valaxyjs/config', '/@valaxyjs/context']
        const moduleEntries = [
          ...Array.from(moduleIds).map(id => server.moduleGraph.getModuleById(id)),
        ].filter(<T>(item: T): item is NonNullable<T> => !!item)

        return moduleEntries
      }

      const configFiles = [options.configFile]

      // handle valaxy.config.ts hmr
      if (configFiles.includes(file)) {
        const { config } = await resolveOptions({ userRoot: options.userRoot })
        return reloadConfigAndEntries(config)
      }

      // siteConfig
      if (file === options.siteConfigFile) {
        const { siteConfig } = await resolveSiteConfig(options.userRoot)
        valaxyConfig.siteConfig = defu<SiteConfig, [SiteConfig]>(siteConfig, defaultSiteConfig)
        return reloadConfigAndEntries(valaxyConfig)
      }

      // themeConfig
      if (file === options.themeConfigFile) {
        const { themeConfig } = await resolveUserThemeConfig(options)
        const pkg = valaxyConfig.themeConfig.pkg
        // @ts-expect-error mount pkg
        themeConfig.pkg = pkg
        valaxyConfig.themeConfig = themeConfig as (DefaultTheme.Config & { pkg: Pkg })
        return reloadConfigAndEntries(valaxyConfig)
      }

      if (file === resolve(options.themeRoot, 'valaxy.config.ts')) {
        const themeValaxyConfig = await resolveThemeValaxyConfig(options)
        const valaxyConfig = mergeValaxyConfig(options.config, themeValaxyConfig)
        const { config } = await processValaxyOptions(options, valaxyConfig)
        return reloadConfigAndEntries(config)
      }

      // send headers
      if (file.endsWith('.md')) {
        const content = await read()
        const { pageData, vueSrc } = await markdownToVue(
          content,
          file,
          join(options.userRoot, 'public'),
        )

        const path = `/${relative(`${options.userRoot}/pages`, file)}`
        const payload: PageDataPayload = {
          path,
          pageData,
        }

        server.ws.send({
          type: 'custom',
          event: 'valaxy:pageData',
          data: payload,
        })

        // overwrite src so vue plugin can handle the HMR
        ctx.read = () => vueSrc

        vLogger.success(`${yellow('[HMR]')} ${path} ${dim(`updated in ${endCount()}`)}`)
      }
    },
  }
}

import type { DefaultTheme, ValaxyAddon } from '../../types'
import type { ResolvedValaxyOptions } from '../options'
import type { ValaxyAddonResolver, ValaxyNodeConfig } from '../types'

export function defineValaxyAddon<AddonOptions = object>(
  addonFunc: (addonOptions?: AddonOptions, valaxyOptions?: ResolvedValaxyOptions) => ValaxyAddon & {
    setup?: ValaxyAddonResolver['setup']
  },
) {
  return addonFunc
}
export const defineAddon = defineValaxyAddon

export type ValaxyConfigExtendKey = 'vite' | 'vue' | 'unocss' | 'unocssPresets' | 'markdown' | 'extendMd' | 'addons'
export type ValaxyPickConfig = Pick<ValaxyNodeConfig, ValaxyConfigExtendKey>
export type ValaxyTheme<ThemeConfig = DefaultTheme.Config> = ValaxyPickConfig & { themeConfig?: ThemeConfig }
export function defineValaxyTheme<ThemeConfig = DefaultTheme.Config>(
  theme: ValaxyTheme<ThemeConfig> | ((options: ResolvedValaxyOptions<ThemeConfig>) => ValaxyTheme<ThemeConfig>),
) {
  return theme
}

export const defineTheme = defineValaxyTheme

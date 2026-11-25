import { DatabaseState, DocumentTemplate, Tab } from '../types/database';
import {
  DEFAULT_INSTALLED_MODULES,
  MODULE_BY_ID,
  MODULE_DEFINITIONS,
  ModuleDefinition
} from '../data/modules';
import { BUILT_IN_TEMPLATES } from '../data/builtInTemplates';
import { INITIAL_TABS } from '../data/initialDatabase';

function cloneTabFromInitial(source: Tab, moduleId: string): Tab {
  const stamp = Date.now().toString(36);
  return {
    ...source,
    id: source.id,
    moduleId,
    rows: [],
    attachedDocs: [],
    columns: source.columns.map((column, index) => ({
      ...column,
      id: `${column.id}_${stamp}${index}`
    }))
  };
}

function cloneTemplate(template: DocumentTemplate, stamp: string): DocumentTemplate {
  return {
    ...template,
    id: `${template.id}_${stamp}`,
    contentTemplate: template.contentTemplate
  };
}

export function getInstalledModules(state: DatabaseState): string[] {
  const configured = state.settings?.installedModules;
  if (Array.isArray(configured)) return configured;
  return DEFAULT_INSTALLED_MODULES;
}

export function isModuleInstalled(state: DatabaseState, moduleId: string): boolean {
  return getInstalledModules(state).includes(moduleId);
}

/** Вкладка видима, если она не принадлежит отключённому модулю. */
export function isTabVisible(tab: Tab, installedModules: string[]): boolean {
  if (!tab.moduleId) return true;
  return installedModules.includes(tab.moduleId);
}

export function getVisibleTabs(state: DatabaseState): Tab[] {
  const installed = getInstalledModules(state);
  return state.tabs.filter((tab) => isTabVisible(tab, installed));
}

export function getModuleForTab(tabId: string): ModuleDefinition | undefined {
  return MODULE_DEFINITIONS.find((module) => module.tabId === tabId);
}

/** Проставляет moduleId вкладкам по известным идентификаторам (миграция старых баз). */
export function stampTabModules(tabs: Tab[]): Tab[] {
  return tabs.map((tab) => {
    if (tab.moduleId) return tab;
    const module = getModuleForTab(tab.id);
    return module ? { ...tab, moduleId: module.id } : tab;
  });
}

/**
 * Установка модуля: создаёт отсутствующий таб (структура клонируется из эталонной),
 * добавляет шаблоны документов модуля и включает его. Существующие данные не трогаются.
 */
export function installModule(state: DatabaseState, moduleId: string): DatabaseState {
  const module = MODULE_BY_ID[moduleId];
  if (!module) return state;

  const installed = getInstalledModules(state);
  if (installed.includes(moduleId)) return state;

  const existingTab = state.tabs.find((tab) => tab.id === module.tabId);
  let tabs = state.tabs;
  if (existingTab) {
    tabs = state.tabs.map((tab) =>
      tab.id === module.tabId ? { ...tab, moduleId: module.id, name: tab.name || module.tabName } : tab
    );
  } else {
    const templateTab = INITIAL_TABS.find((tab) => tab.id === module.tabId);
    const newTab = templateTab
      ? cloneTabFromInitial(templateTab, module.id)
      : {
          id: module.tabId,
          name: module.tabName,
          moduleId: module.id,
          columns: [],
          rows: [],
          attachedDocs: []
        };
    tabs = [...state.tabs, newTab];
  }

  const stamp = Date.now().toString(36);
  const knownTemplateIds = new Set(state.templates.map((tpl) => tpl.id.replace(/_[a-z0-9]+$/i, '')));
  const missingTemplates = BUILT_IN_TEMPLATES.filter(
    (tpl) => tpl.tabId === module.tabId && !knownTemplateIds.has(tpl.id)
  ).map((tpl) => cloneTemplate(tpl, stamp));

  return {
    ...state,
    tabs,
    templates: missingTemplates.length ? [...state.templates, ...missingTemplates] : state.templates,
    settings: {
      ...state.settings,
      installedModules: [...installed, moduleId]
    }
  };
}

/** Отключение модуля: вкладка скрывается, данные остаются в базе. */
export function disableModule(state: DatabaseState, moduleId: string): DatabaseState {
  const installed = getInstalledModules(state);
  if (!installed.includes(moduleId)) return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      installedModules: installed.filter((id) => id !== moduleId)
    }
  };
}

export function countModuleRows(state: DatabaseState, module: ModuleDefinition): number {
  const tab = state.tabs.find((item) => item.id === module.tabId);
  return tab ? tab.rows.length : 0;
}

export const moduleService = {
  getInstalledModules,
  isModuleInstalled,
  isTabVisible,
  getVisibleTabs,
  getModuleForTab,
  stampTabModules,
  installModule,
  disableModule,
  countModuleRows
};

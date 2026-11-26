import { DatabaseState, DocumentTemplate, Tab, Tag } from '../types/database';
import {
  DEFAULT_INSTALLED_MODULES,
  MODULE_BY_ID,
  MODULE_DEFINITIONS,
  ModuleDefinition
} from '../data/modules';
import { BUILT_IN_TEMPLATES } from '../data/builtInTemplates';
import { INITIAL_TABS, INITIAL_TAGS } from '../data/initialDatabase';

const BUILT_IN_TEMPLATE_IDS = new Set(BUILT_IN_TEMPLATES.map((tpl) => tpl.id));

function findModuleTab(tabs: Tab[], moduleId: string, defaultTabId: string): Tab | undefined {
  return tabs.find((tab) => tab.moduleId === moduleId || tab.id === defaultTabId);
}

function resolveMasterTabId(masterTabId: string, existingTabs: Tab[]): string {
  if (masterTabId === 'tab_employees') {
    return findModuleTab(existingTabs, 'employees', 'tab_employees')?.id || masterTabId;
  }
  if (masterTabId === 'tab_positions') {
    return findModuleTab(existingTabs, 'staffing', 'tab_positions')?.id || masterTabId;
  }
  if (masterTabId === 'tab_factors') {
    return findModuleTab(existingTabs, 'sout', 'tab_factors')?.id || masterTabId;
  }
  return masterTabId;
}

function cloneTabFromInitial(source: Tab, moduleId: string, existingTabs: Tab[]): Tab {
  const clonedColumns = (JSON.parse(JSON.stringify(source.columns)) as Tab['columns']).map((column) => {
    if (column.relation?.masterTabId) {
      return {
        ...column,
        relation: {
          ...column.relation,
          masterTabId: resolveMasterTabId(column.relation.masterTabId, existingTabs)
        }
      };
    }
    return column;
  });

  return {
    ...source,
    id: source.id,
    moduleId,
    rows: [],
    attachedDocs: [],
    columns: clonedColumns
  };
}

function cloneTemplate(
  template: DocumentTemplate,
  existingIds: Set<string>,
  stamp: string
): DocumentTemplate {
  const resolvedId = existingIds.has(template.id) ? `${template.id}_${stamp}` : template.id;
  existingIds.add(resolvedId);
  return {
    ...template,
    id: resolvedId,
    builtInId: template.id,
    contentTemplate: template.contentTemplate
  };
}

function isBuiltInTemplatePresent(existingTemplates: DocumentTemplate[], builtInId: string): boolean {
  return existingTemplates.some(
    (tpl) =>
      tpl.id === builtInId ||
      tpl.builtInId === builtInId ||
      (BUILT_IN_TEMPLATE_IDS.has(builtInId) && tpl.id.startsWith(`${builtInId}_`))
  );
}

function seedMissingModuleTags(existingTags: Tag[], tabs: Tab[], installedTabDefaultId: string): Tag[] {
  const nextTags = [...existingTags];
  const existingNames = new Set(existingTags.map((tag) => tag.name));
  const targetDefaultTabIds = new Set([installedTabDefaultId, 'tab_positions', 'tab_employees']);

  const tabByDefaultId: Record<string, Tab | undefined> = {
    tab_positions: findModuleTab(tabs, 'staffing', 'tab_positions'),
    tab_employees: findModuleTab(tabs, 'employees', 'tab_employees'),
    [installedTabDefaultId]:
      tabs.find((tab) => tab.id === installedTabDefaultId) ||
      tabs.find((tab) => tab.moduleId === getModuleForTab(installedTabDefaultId)?.id)
  };

  INITIAL_TAGS.forEach((candidate) => {
    if (!targetDefaultTabIds.has(candidate.tabId)) return;
    if (existingNames.has(candidate.name)) return;
    const targetTab = tabByDefaultId[candidate.tabId];
    if (!targetTab) return;
    const hasColumn = targetTab.columns.some((col) => col.id === candidate.columnId);
    if (!hasColumn) return;
    existingNames.add(candidate.name);
    nextTags.push({
      ...candidate,
      tabId: targetTab.id
    });
  });

  return nextTags;
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
 * добавляет шаблоны документов и недостающие теги модуля и включает его. Существующие данные не трогаются.
 */
export function installModule(state: DatabaseState, moduleId: string): DatabaseState {
  const module = MODULE_BY_ID[moduleId];
  if (!module) return state;

  const installed = getInstalledModules(state);
  if (installed.includes(moduleId)) return state;

  const existingTab = findModuleTab(state.tabs, module.id, module.tabId);
  let tabs = state.tabs;
  if (existingTab) {
    tabs = state.tabs.map((tab) =>
      tab.id === existingTab.id ? { ...tab, moduleId: module.id, name: tab.name || module.tabName } : tab
    );
  } else {
    const templateTab = INITIAL_TABS.find((tab) => tab.id === module.tabId);
    const newTab = templateTab
      ? cloneTabFromInitial(templateTab, module.id, state.tabs)
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
  const existingTemplateIds = new Set(state.templates.map((tpl) => tpl.id));
  const missingTemplates = BUILT_IN_TEMPLATES.filter(
    (tpl) => tpl.tabId === module.tabId && !isBuiltInTemplatePresent(state.templates, tpl.id)
  ).map((tpl) => cloneTemplate(tpl, existingTemplateIds, stamp));

  const nextTags = seedMissingModuleTags(state.tags || [], tabs, module.tabId);

  return {
    ...state,
    tabs,
    tags: nextTags,
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
  const tab = findModuleTab(state.tabs, module.id, module.tabId);
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

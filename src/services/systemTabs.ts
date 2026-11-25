/**
 * Идентификаторы системных (закреплённых) вкладок.
 * Они не хранятся в DatabaseState и не участвуют в D&D/переименовании.
 */
export const SYSTEM_DASHBOARD_TAB_ID = '__system_dashboard__';
export const SYSTEM_DASHBOARD_TAB_LABEL = 'Главная';

export function isSystemDashboardTab(tabId: string | null | undefined): boolean {
  return tabId === SYSTEM_DASHBOARD_TAB_ID;
}

import { createContext, useContext, type PropsWithChildren } from 'react'

export type AppLanguage = 'en' | 'ru'

type I18nContextValue = {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: (value: string) => string
}

const ru: Record<string, string> = {
  'API keys': 'API-ключи',
  Active: 'Активна',
  active: 'активна',
  'Admin actions': 'Действия администратора',
  'All nodes': 'Все ноды',
  Attention: 'Внимание',
  'Automation access': 'Доступ автоматизации',
  'Cache purge and preview hooks': 'Сброс кеша и предпросмотр',
  'Client compatibility switches': 'Переключатели совместимости клиентов',
  'Client surface': 'Клиентская поверхность',
  'Close navigation': 'Закрыть навигацию',
  'Close navigation overlay': 'Закрыть затемнение навигации',
  Command: 'Команда',
  'Command dashboard': 'Командная панель',
  'Config hash': 'Хеш конфига',
  'Configure feed': 'Настроить ленту',
  Control: 'Управление',
  'Control Plane Operator': 'Оператор панели',
  Dashboard: 'Главная',
  Delivery: 'Доставка',
  'Delivery profile': 'Профиль доставки',
  'Endpoint pending': 'Эндпоинт ожидает настройки',
  'Expires': 'Истекает',
  Governance: 'Контроль',
  'Guard portal': 'Guard-портал',
  Help: 'Помощь',
  Hosts: 'Хосты',
  Instance: 'Инстанс',
  'Interface language': 'Язык интерфейса',
  License: 'Лицензия',
  'License seats': 'Места лицензии',
  'Live API': 'Живой API',
  'Live state from the panel API. Empty values mean the backend has no recorded data yet.':
    'Живое состояние из API панели. Пустые значения означают, что backend ещё не записал данные.',
  'Loading subscriptions...': 'Загрузка подписок...',
  'Lumen control plane': 'Панель управления Lumen',
  'New user': 'Новый пользователь',
  'No active notifications': 'Активных уведомлений нет',
  'No live activity is recorded yet.': 'Живых событий пока нет.',
  'No matches': 'Совпадений нет',
  'No matching section found.': 'Раздел не найден.',
  None: 'Нет',
  'No subscriptions': 'Подписок нет',
  'Not generated': 'Не сгенерирован',
  'Not set': 'Не задано',
  'Node heartbeat, license, and API health alerts are clear.':
    'Heartbeat нод, лицензия и состояние API без активных предупреждений.',
  Nodes: 'Ноды',
  Node: 'Нода',
  Notifications: 'Уведомления',
  'Open navigation': 'Открыть навигацию',
  'Open nodes': 'Открыть ноды',
  Opening: 'Открываю',
  Primary: 'Основная',
  'Primary navigation': 'Основная навигация',
  'Public ID': 'Публичный ID',
  'Public config surface': 'Публичная поверхность конфига',
  Profiles: 'Профили',
  Refresh: 'Обновить',
  'Refresh Subscription': 'Обновить подписки',
  'Refresh subscription': 'Обновить подписки',
  'Response rules': 'Правила ответов',
  'Recent operations': 'Последние операции',
  'Risk watch': 'Контроль рисков',
  Search: 'Поиск',
  'Search control plane': 'Поиск по панели',
  'Search results': 'Результаты поиска',
  'Search users, nodes, hosts': 'Поиск пользователей, нод, хостов',
  Settings: 'Настройки',
  'Sign out': 'Выйти',
  'Skip to content': 'Перейти к содержимому',
  Squads: 'Сквады',
  Status: 'Статус',
  Subscription: 'Подписки',
  'Subscription Page': 'Страница подписки',
  'Subscription feed records': 'Записи ленты подписок',
  'Subscription inventory': 'Инвентарь подписок',
  'Subscription records will appear after user/license/node bindings are created.':
    'Записи подписок появятся после создания связок пользователь/лицензия/нода.',
  'Subscriptions unavailable': 'Подписки недоступны',
  Templates: 'Шаблоны',
  Tools: 'Инструменты',
  'Traffic used': 'Использованный трафик',
  User: 'Пользователь',
  Users: 'Пользователи',
  'api-ready': 'api готов',
  'read-only': 'только чтение',
  'Safe URL rendering with no secrets logged': 'Безопасная генерация URL без записи секретов в логи',
  'Control subscription endpoint behavior, cache windows, and client metadata.':
    'Управление поведением эндпоинта подписки, окнами кеша и метаданными клиентов.',
  revoked: 'отозвана',
  disabled: 'выключена',
  expired: 'истекла',
  limited: 'ограничена',
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({
  children,
  language,
  setLanguage,
}: PropsWithChildren<{
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
}>) {
  const t = (value: string) => (language === 'ru' ? ru[value] ?? value : value)

  return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    return {
      language: 'en' as AppLanguage,
      setLanguage: () => undefined,
      t: (value: string) => value,
    }
  }
  return context
}

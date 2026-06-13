import type { ReactNode } from 'react'
import { useI18n } from '../i18n/I18nProvider'

type DataTableRow = {
  cells: ReactNode[]
  className?: string
  id: string
}

type DataTableProps = {
  caption: string
  columns: string[]
  rows: DataTableRow[]
}

export function DataTable({ caption, columns, rows }: DataTableProps) {
  const { t } = useI18n()

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption>{t(caption)}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.className} key={row.id}>
              {row.cells.map((cell, index) => (
                <td key={`${row.id}-${columns[index]}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

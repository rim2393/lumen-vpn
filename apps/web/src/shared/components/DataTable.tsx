import type { ReactNode } from 'react'

type DataTableRow = {
  cells: ReactNode[]
  id: string
}

type DataTableProps = {
  caption: string
  columns: string[]
  rows: DataTableRow[]
}

export function DataTable({ caption, columns, rows }: DataTableProps) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
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

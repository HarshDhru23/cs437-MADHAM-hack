import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Plain text used as the stacked-mobile cell label. */
  label?: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  rowHeader?: boolean;
}

interface DataTableProps<T> {
  caption: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  rowProps?: (row: T) => Record<string, string | undefined>;
  captionHidden?: boolean;
}

export function DataTable<T>({ caption, columns, rows, rowKey, empty = 'Nothing to show.', rowProps, captionHidden }: DataTableProps<T>) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="data stack-mobile">
        <caption className={captionHidden ? 'visually-hidden' : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} {...(rowProps?.(row) ?? {})}>
              {columns.map((c) => {
                const label = c.label ?? (typeof c.header === 'string' ? c.header : c.key);
                return c.rowHeader ? (
                  <th key={c.key} scope="row" data-label={label}>
                    {c.render(row)}
                  </th>
                ) : (
                  <td key={c.key} data-label={label} className={c.numeric ? 'num' : undefined}>
                    {c.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

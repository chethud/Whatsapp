import type { ReactNode } from "react";

export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | number | null | undefined | ReactNode>>;
}) {  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-800/80 text-slate-300">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-slate-800">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 text-slate-200">
                  {cell ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS = ['#94a3b8', '#22c55e', '#6366f1', '#f97316']

export function PlanBreakdownPieChart({ breakdown = {} }) {
  const chartData = [
    { name: 'Anonymous', value: breakdown.anon ?? 0 },
    { name: 'Free', value: breakdown.free ?? 0 },
    { name: 'Pro', value: breakdown.pro ?? 0 },
    { name: 'Team', value: breakdown.team ?? 0 },
  ]

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

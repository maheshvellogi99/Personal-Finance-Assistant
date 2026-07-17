'use client';

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartDataPoint {
  date: string;
  amount: number;
}

interface CashflowChartProps {
  chartData: ChartDataPoint[];
  formatCurrency: (val: number) => string;
}

export default function CashflowChart({ chartData, formatCurrency }: CashflowChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
        <XAxis 
          dataKey="date" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#888888', fontSize: 10 }}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#888888', fontSize: 10 }}
          tickFormatter={(val) => `₹${val}`}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#121212', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
          itemStyle={{ color: '#fff' }}
          labelStyle={{ color: '#888', fontWeight: 'bold' }}
          formatter={(value: any) => [formatCurrency(value), 'Expenses']}
        />
        <Bar 
          dataKey="amount" 
          fill="#FF9900" 
          radius={[4, 4, 0, 0]} 
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

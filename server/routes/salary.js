import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ============ 工时工资模块（精细化计算） ============

// 时间字符串 "HH:MM" → 分钟数
function toMin(t) {
  const p = String(t || '').split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

// 分钟 → "HH:MM"
function toTime(m) {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// 判断是否为周末（0=周日，6=周六）
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

// 判断是否为法定节假日（简化版：固定日期 + 可配置）
function isHoliday(dateStr, holidays) {
  const m = dateStr.slice(5, 7);
  const d = dateStr.slice(8, 10);
  const key = m + '-' + d;
  // 春节、清明、五一、端午、中秋、国庆、元旦等常见假期
  const fixedHolidays = [
    '01-01', // 元旦
    '05-01', '05-02', '05-03', // 五一
    '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07', // 国庆
  ];
  const springFestival = ['01-28','01-29','01-30','01-31','02-01','02-02','02-03','02-04','02-05','02-06']; // 示例春节
  const allHolidays = fixedHolidays.concat(holidays || [], springFestival);
  return allHolidays.indexOf(key) !== -1;
}

// 计算单条记录的计薪工时（小时）。
// 支持跨天（晚班至次日凌晨），并扣除休息时段（若配置了 break_start/break_end）。
function calcWorkHours(start, end, breakStart, breakEnd) {
  let s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 24 * 60; // 跨天

  let workMin = e - s;
  if (workMin <= 0) return 0;

  // 扣除休息时段（有配置时）
  if (breakStart && breakEnd) {
    let bs = toMin(breakStart);
    let be = toMin(breakEnd);
    if (be <= bs) be += 24 * 60; // 休息段跨天

    const breaks = [[bs, be], [bs + 24 * 60, be + 24 * 60]];
    breaks.forEach(function (seg) {
      const overlapStart = Math.max(s, seg[0]);
      const overlapEnd = Math.min(e, seg[1]);
      if (overlapEnd > overlapStart) {
        workMin -= (overlapEnd - overlapStart);
      }
    });
    if (workMin < 0) workMin = 0;
  }

  return workMin / 60;
}

// 计算单条记录的工资明细
function calcSalaryDetail(workDate, startTime, endTime, content, cfg, holidays) {
  const totalHours = calcWorkHours(startTime, endTime, cfg.break_start, cfg.break_end);
  const weekend = isWeekend(workDate);
  const holiday = isHoliday(workDate, holidays);
  
  let baseHours = 0;      // 基本工时（按标准工作制）
  let overtimeHours = 0;  // 加班工时
  let hourlyRate = cfg.hourly_rate / 100; // 转换为元
  
  if (cfg.mode === 'hourly') {
    // 标准工作日：8小时/天，超过算加班
    const standardHours = 8;
    if (totalHours > standardHours) {
      baseHours = standardHours;
      overtimeHours = totalHours - standardHours;
    } else {
      baseHours = totalHours;
      overtimeHours = 0;
    }
    
    // 计算加班费率
    let overtimeRate = hourlyRate;
    if (holiday) {
      overtimeRate = hourlyRate * 3; // 节假日3倍
    } else if (weekend) {
      overtimeRate = hourlyRate * 2; // 周末2倍
    } else {
      overtimeRate = hourlyRate * 1.5; // 工作日1.5倍
    }
    
    const baseSalary = baseHours * hourlyRate;
    const overtimeSalary = overtimeHours * overtimeRate;
    const grossSalary = baseSalary + overtimeSalary;
    
    return {
      work_date: workDate,
      start_time: startTime,
      end_time: endTime,
      content: content || '工作',
      total_hours: Math.round(totalHours * 100) / 100,
      base_hours: Math.round(baseHours * 100) / 100,
      overtime_hours: Math.round(overtimeHours * 100) / 100,
      hourly_rate: hourlyRate,
      overtime_rate: overtimeRate,
      base_salary: Math.round(baseSalary * 100) / 100,
      overtime_salary: Math.round(overtimeSalary * 100) / 100,
      gross_salary: Math.round(grossSalary * 100) / 100,
      is_weekend: weekend,
      is_holiday: holiday,
    };
  } else {
    // 按天计薪
    const dailyRate = cfg.daily_rate / 100;
    let salary = dailyRate;
    let overtimeSalary = 0;
    
    // 超过8小时算加班
    if (totalHours > 8) {
      const overtimeHours = totalHours - 8;
      let overtimeRate = dailyRate / 8;
      if (holiday) {
        overtimeRate = overtimeRate * 3;
      } else if (weekend) {
        overtimeRate = overtimeRate * 2;
      } else {
        overtimeRate = overtimeRate * 1.5;
      }
      overtimeSalary = Math.round(overtimeHours * overtimeRate * 100) / 100;
      salary = Math.round((dailyRate + overtimeSalary) * 100) / 100;
    }
    
    return {
      work_date: workDate,
      start_time: startTime,
      end_time: endTime,
      content: content || '工作',
      total_hours: Math.round(totalHours * 100) / 100,
      base_hours: 8,
      overtime_hours: Math.round((totalHours - 8) * 100) / 100,
      hourly_rate: dailyRate / 8,
      overtime_rate: dailyRate / 8 * (holiday ? 3 : weekend ? 2 : 1.5),
      base_salary: dailyRate,
      overtime_salary: overtimeSalary,
      gross_salary: salary,
      is_weekend: weekend,
      is_holiday: holiday,
    };
  }
}

// 获取或初始化工资配置
function getConfig(userId) {
  let cfg = db.prepare('SELECT * FROM salary_config WHERE user_id = ?').get(userId);
  if (!cfg) {
    db.prepare('INSERT INTO salary_config (user_id) VALUES (?)').run(userId);
    cfg = db.prepare('SELECT * FROM salary_config WHERE user_id = ?').get(userId);
  }
  return cfg;
}

router.get('/config', (req, res) => {
  const cfg = getConfig(req.user.id);
  res.json({
    mode: cfg.mode,
    hourly_rate: cfg.hourly_rate,
    daily_rate: cfg.daily_rate,
    work_start: cfg.work_start || '09:00',
    work_end: cfg.work_end || '18:00',
    break_start: cfg.break_start || '',
    break_end: cfg.break_end || '',
    // 新增：扣除项配置
    tax_threshold: cfg.tax_threshold || 5000,
    social_security: cfg.social_security || 0,
    housing_fund: cfg.housing_fund || 0,
    other_deduction: cfg.other_deduction || 0,
    // 新增：节假日列表
    holidays: cfg.holidays ? JSON.parse(cfg.holidays) : [],
    // 新增：标准工作时长
    standard_hours: cfg.standard_hours || 8,
  });
});

router.put('/config', (req, res) => {
  const b = req.body || {};
  const mode = b.mode === 'daily' ? 'daily' : 'hourly';
  const hourly_rate = Math.max(1, Math.round(Number(b.hourly_rate) || 0));
  const daily_rate = Math.max(1, Math.round(Number(b.daily_rate) || 0));
  const work_start = String(b.work_start || '09:00').trim();
  const work_end = String(b.work_end || '18:00').trim();
  const break_start = String(b.break_start || '').trim();
  const break_end = String(b.break_end || '').trim();
  const tax_threshold = Math.max(0, Number(b.tax_threshold) || 5000);
  const social_security = Math.max(0, Number(b.social_security) || 0);
  const housing_fund = Math.max(0, Number(b.housing_fund) || 0);
  const other_deduction = Math.max(0, Number(b.other_deduction) || 0);
  const holidays = Array.isArray(b.holidays) ? JSON.stringify(b.holidays) : '[]';
  
  const standard_hours = Math.max(1, Number(b.standard_hours) || 8);
  db.prepare("UPDATE salary_config SET mode = ?, hourly_rate = ?, daily_rate = ?, work_start = ?, work_end = ?, break_start = ?, break_end = ?, tax_threshold = ?, social_security = ?, housing_fund = ?, other_deduction = ?, standard_hours = ?, holidays = ?, updated_at = datetime('now','localtime') WHERE user_id = ?")
    .run(mode, hourly_rate, daily_rate, work_start, work_end, break_start || null, break_end || null, tax_threshold, social_security, housing_fund, other_deduction, standard_hours, holidays, req.user.id);
  res.json({ ok: true });
});

// 简化个税计算（累计预扣法）
function calcTax(monthlyIncome, month, cumulativeIncome) {
  const threshold = 5000; // 起征点
  const taxable = cumulativeIncome - threshold * month;
  if (taxable <= 0) return 0;
  
  // 简化税率表
  const brackets = [
    { limit: 36000, rate: 0.03, deduction: 0 },
    { limit: 144000, rate: 0.10, deduction: 2520 },
    { limit: 300000, rate: 0.20, deduction: 16920 },
    { limit: 420000, rate: 0.25, deduction: 31920 },
    { limit: 660000, rate: 0.30, deduction: 52920 },
    { limit: 960000, rate: 0.35, deduction: 85920 },
    { limit: Infinity, rate: 0.45, deduction: 181920 },
  ];
  
  const prevCumulative = cumulativeIncome - monthlyIncome;
  const prevTax = calcTaxBracket(prevCumulative - threshold * (month - 1), month - 1);
  const currentTax = calcTaxBracket(taxable, month);
  
  return Math.round((currentTax - prevTax) * 100) / 100;
}

function calcTaxBracket(taxable, month) {
  if (taxable <= 0) return 0;
  const brackets = [
    { limit: 36000, rate: 0.03, deduction: 0 },
    { limit: 144000, rate: 0.10, deduction: 2520 },
    { limit: 300000, rate: 0.20, deduction: 16920 },
    { limit: 420000, rate: 0.25, deduction: 31920 },
    { limit: 660000, rate: 0.30, deduction: 52920 },
    { limit: 960000, rate: 0.35, deduction: 85920 },
    { limit: Infinity, rate: 0.45, deduction: 181920 },
  ];
  
  for (const b of brackets) {
    if (taxable <= b.limit) {
      return taxable * b.rate - b.deduction;
    }
  }
  return 0;
}

router.get('/records', (req, res) => {
  const now = new Date();
  const defMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : defMonth;
  const cfg = getConfig(req.user.id);
  const holidays = cfg.holidays ? JSON.parse(cfg.holidays) : [];
  
  const rows = db.prepare(
    'SELECT id, work_date, start_time, end_time, content FROM work_records WHERE user_id = ? AND substr(work_date,1,7) = ? ORDER BY work_date DESC, id DESC'
  ).all(req.user.id, month);

  let totalHours = 0;
  let totalBaseSalary = 0;
  let totalOvertimeSalary = 0;
  let totalGrossSalary = 0;
  let totalOvertimeHours = 0;
  const items = rows.map(function (r) {
    const detail = calcSalaryDetail(r.work_date, r.start_time, r.end_time, r.content, cfg, holidays);
    totalHours += detail.total_hours;
    totalBaseSalary += detail.base_salary;
    totalOvertimeSalary += detail.overtime_salary;
    totalGrossSalary += detail.gross_salary;
    totalOvertimeHours += detail.overtime_hours;
    return {
      id: r.id,
      work_date: r.work_date,
      start_time: r.start_time,
      end_time: r.end_time,
      content: r.content,
      ...detail,
    };
  });

  // 计算扣除项和实发工资
  const monthNum = parseInt(month.split('-')[1], 10);
  const tax = calcTax(totalGrossSalary, monthNum, totalGrossSalary);
  const totalDeduction = (cfg.social_security || 0) + (cfg.housing_fund || 0) + (cfg.other_deduction || 0) + tax;
  const netSalary = Math.round((totalGrossSalary - totalDeduction) * 100) / 100;

  res.json({
    month,
    mode: cfg.mode,
    hourly_rate: cfg.hourly_rate,
    daily_rate: cfg.daily_rate,
    work_start: cfg.work_start || '09:00',
    work_end: cfg.work_end || '18:00',
    break_start: cfg.break_start || '',
    break_end: cfg.break_end || '',
    // 新增：扣除项配置
    tax_threshold: cfg.tax_threshold || 5000,
    social_security: cfg.social_security || 0,
    housing_fund: cfg.housing_fund || 0,
    other_deduction: cfg.other_deduction || 0,
    // 统计
    total_hours: Math.round(totalHours * 100) / 100,
    total_base_salary: Math.round(totalBaseSalary * 100) / 100,
    total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
    total_overtime_salary: Math.round(totalOvertimeSalary * 100) / 100,
    total_gross_salary: Math.round(totalGrossSalary * 100) / 100,
    total_tax: Math.round(tax * 100) / 100,
    total_deduction: Math.round(totalDeduction * 100) / 100,
    net_salary: netSalary,
    count: items.length,
    items,
  });
});

router.post('/records', (req, res) => {
  const b = req.body || {};
  const work_date = b.work_date;
  const start_time = b.start_time;
  const end_time = b.end_time;
  const content = String(b.content || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date || '')) return res.status(400).json({ error: '日期格式不正确' });
  if (!/^\d{1,2}:\d{2}$/.test(start_time || '') || !/^\d{1,2}:\d{2}$/.test(end_time || '')) {
    return res.status(400).json({ error: '时间格式不正确（如 09:00）' });
  }
  db.prepare('INSERT INTO work_records (user_id, work_date, start_time, end_time, content) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, work_date, start_time, end_time, content);
  res.json({ ok: true });
});

router.delete('/records/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM work_records WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM work_records WHERE id = ?').run(id);
  res.json({ ok: true });
});

// 导出工资明细 CSV
router.get('/export', (req, res) => {
  const now = new Date();
  const defMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : defMonth;
  const cfg = getConfig(req.user.id);
  const holidays = cfg.holidays ? JSON.parse(cfg.holidays) : [];
  
  const rows = db.prepare(
    'SELECT work_date, start_time, end_time, content FROM work_records WHERE user_id = ? AND substr(work_date,1,7) = ? ORDER BY work_date ASC, id ASC'
  ).all(req.user.id, month);

  let totalHours = 0;
  let totalBaseSalary = 0;
  let totalOvertimeSalary = 0;
  let totalGrossSalary = 0;
  const items = rows.map(function (r) {
    const detail = calcSalaryDetail(r.work_date, r.start_time, r.end_time, r.content, cfg, holidays);
    totalHours += detail.total_hours;
    totalBaseSalary += detail.base_salary;
    totalOvertimeSalary += detail.overtime_salary;
    totalGrossSalary += detail.gross_salary;
    return detail;
  });

  const monthNum = parseInt(month.split('-')[1], 10);
  const tax = calcTax(totalGrossSalary, monthNum, totalGrossSalary);
  const totalDeduction = (cfg.social_security || 0) + (cfg.housing_fund || 0) + (cfg.other_deduction || 0) + tax;
  const netSalary = Math.round((totalGrossSalary - totalDeduction) * 100) / 100;

  let csv = '\uFEFF'; // BOM for Excel
  csv += '日期,上班时间,下班时间,工作内容,总工时,基本工时,加班工时,时薪,加班费率,基本工资,加班费,小计,是否周末,是否节假日\n';
  items.forEach(function (it) {
    csv += [
      it.work_date,
      it.start_time,
      it.end_time,
      '"' + (it.content || '').replace(/"/g, '""') + '"',
      it.total_hours.toFixed(2),
      it.base_hours.toFixed(2),
      it.overtime_hours.toFixed(2),
      it.hourly_rate.toFixed(2),
      it.overtime_rate.toFixed(2),
      it.base_salary.toFixed(2),
      it.overtime_salary.toFixed(2),
      it.gross_salary.toFixed(2),
      it.is_weekend ? '是' : '否',
      it.is_holiday ? '是' : '否',
    ].join(',') + '\n';
  });
  csv += '合计,,,,' + totalHours.toFixed(2) + ',,' + items.reduce((s, it) => s + it.overtime_hours, 0).toFixed(2) + ',,,' + totalBaseSalary.toFixed(2) + ',' + totalOvertimeSalary.toFixed(2) + ',' + totalGrossSalary.toFixed(2) + ',,';
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="salary-' + month + '.csv"');
  res.send(csv);
});

export default router;

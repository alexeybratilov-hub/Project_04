export interface OccupationPpeItem {
  name: string;
  unit: 'комплект' | 'шт.' | 'пара' | 'упак.';
  annualNorm: number;
  wearMonths: number;
  basis766n: string;
}

export interface OccupationNormPreset {
  keywords: string[];
  factorCode29n: string;
  factorName: string;
  soutClass: string;
  medPeriodicityMonths: number;
  ppeItems: OccupationPpeItem[];
}

/**
 * Встроенный справочник соответствия типовых профессий вредным факторам
 * (Приказ Минздрава № 29н) и Единым типовым нормам выдачи СИЗ (Приказ Минтруда № 766н).
 */
/**
 * Справочный характер норм: пресеты подбираются по ключевым словам должности,
 * а не по фактическим результатам СОУТ. Текст показывается рядом с подстановкой
 * и в README, чтобы комплект СИЗ не воспринимался как окончательный.
 */
export const OCCUPATION_NORMS_DISCLAIMER =
  'Нормы подставлены по справочнику приложения (29н/766н) и носят справочный характер: перед выдачей СИЗ и направлением на медосмотр проверьте актуальные ЕТН, результаты СОУТ и отраслевые правила.';
export const OCCUPATION_NORM_PRESETS: OccupationNormPreset[] = [
  {
    keywords: ['сварщ', 'электрогазосвар', 'газосвар', 'резчик'],
    factorCode29n: '1.1.4',
    factorName: 'Аэрозоли фиброгенного действия (сварочный аэрозоль)',
    soutClass: '3.2 (вредный 2 ст.)',
    medPeriodicityMonths: 12,
    ppeItems: [
      {
        name: 'Костюм сварщика огнестойкий',
        unit: 'комплект',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 5342'
      },
      {
        name: 'Щиток защитный сварочный с автозатемнением',
        unit: 'шт.',
        annualNorm: 1,
        wearMonths: 24,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 5342'
      }
    ]
  },
  {
    keywords: ['слесар', 'ремонтник', 'механик', 'наладчик'],
    factorCode29n: '4.4',
    factorName: 'Шум производственный (свыше 80 дБА)',
    soutClass: '3.1 (вредный 1 ст.)',
    medPeriodicityMonths: 12,
    ppeItems: [
      {
        name: 'Ботинки защитные с композитным подноском',
        unit: 'пара',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 4462'
      },
      {
        name: 'Перчатки с полимерным покрытием',
        unit: 'пара',
        annualNorm: 6,
        wearMonths: 2,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 4462'
      }
    ]
  },
  {
    keywords: ['водител', 'погрузчик', 'тракторист', 'машинист'],
    factorCode29n: '5.1',
    factorName: 'Тяжесть трудового процесса (подъем и перемещение тяжестей)',
    soutClass: '3.1 (вредный 1 ст.)',
    medPeriodicityMonths: 12,
    ppeItems: [
      {
        name: 'Жилет сигнальный повышенной видимости',
        unit: 'шт.',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 784'
      },
      {
        name: 'Ботинки защитные с металлическим подноском',
        unit: 'пара',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 784'
      }
    ]
  },
  {
    keywords: ['маляр', 'окрас', 'лакокрас', 'гальваник'],
    factorCode29n: '1.2.32',
    factorName: 'Органические растворители и ЛКМ',
    soutClass: '3.2 (вредный 2 ст.)',
    medPeriodicityMonths: 12,
    ppeItems: [
      {
        name: 'Полумаска изолирующая с противогазовыми фильтрами',
        unit: 'комплект',
        annualNorm: 2,
        wearMonths: 6,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 2218'
      },
      {
        name: 'Перчатки химостойкие',
        unit: 'пара',
        annualNorm: 6,
        wearMonths: 2,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 2218'
      }
    ]
  },
  {
    keywords: ['электромонт', 'электрик', 'энергет', 'электрослесар'],
    factorCode29n: '4.4',
    factorName: 'Шум производственный (свыше 80 дБА)',
    soutClass: '3.1 (вредный 1 ст.)',
    medPeriodicityMonths: 12,
    ppeItems: [
      {
        name: 'Перчатки диэлектрические',
        unit: 'пара',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 5354'
      },
      {
        name: 'Костюм от термических рисков электрической дуги',
        unit: 'комплект',
        annualNorm: 1,
        wearMonths: 24,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 5354'
      }
    ]
  },
  {
    keywords: ['оператор', 'станоч', 'токар', 'фрезеров'],
    factorCode29n: '4.3',
    factorName: 'Локальная вибрация ручного инструмента',
    soutClass: '2.0 (допустимый)',
    medPeriodicityMonths: 24,
    ppeItems: [
      {
        name: 'Костюм рабочий от общих производственных загрязнений',
        unit: 'комплект',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 3190'
      },
      {
        name: 'Очки защитные открытые',
        unit: 'шт.',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 3190'
      }
    ]
  },
  {
    keywords: ['кладовщ', 'грузчик', 'комплектов'],
    factorCode29n: '5.1',
    factorName: 'Тяжесть трудового процесса (подъем и перемещение тяжестей)',
    soutClass: '2.0 (допустимый)',
    medPeriodicityMonths: 24,
    ppeItems: [
      {
        name: 'Костюм рабочий для защиты от общих производственных загрязнений',
        unit: 'комплект',
        annualNorm: 1,
        wearMonths: 12,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 1665'
      }
    ]
  },
  {
    keywords: ['начальник', 'директор', 'руководител', 'мастер', 'инженер'],
    factorCode29n: '',
    factorName: '',
    soutClass: '2.0 (допустимый)',
    medPeriodicityMonths: 24,
    ppeItems: [
      {
        name: 'Каска защитная (при посещении производственных цехов)',
        unit: 'шт.',
        annualNorm: 1,
        wearMonths: 24,
        basis766n: 'Приказ Минтруда № 766н, ЕТН п. 2851'
      }
    ]
  }
];

export function resolveOccupationNormByTitle(positionTitle: string): OccupationNormPreset | undefined {
  const normalized = String(positionTitle || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return OCCUPATION_NORM_PRESETS.find((preset) =>
    preset.keywords.some((kw) => normalized.includes(kw))
  );
}

export function formatOccupationPpeSummary(items: OccupationPpeItem[]): string {
  return items
    .map((item) => `${item.name} (${item.annualNorm} ${item.unit}/${item.wearMonths} мес.)`)
    .join('; ');
}

/** Parses a human-readable PPE norm string like "Костюм сварщика (1 комплект/12 мес.)" into structured fields. */
export function parsePpeSummaryItem(summaryText: string): OccupationPpeItem | undefined {
  const firstSegment = String(summaryText || '')
    .split(';')[0]
    ?.trim();
  if (!firstSegment) return undefined;
  const match = /^(.+?)\s*\(\s*(\d+)\s*([^/]+?)\s*\/\s*(\d+)\s*мес/i.exec(firstSegment);
  if (!match) {
    return {
      name: firstSegment,
      unit: 'шт.',
      annualNorm: 1,
      wearMonths: 12,
      basis766n: 'Приказ Минтруда № 766н'
    };
  }
  const rawUnit = match[3].trim().toLowerCase();
  const unit: OccupationPpeItem['unit'] =
    rawUnit.startsWith('компл')
      ? 'комплект'
      : rawUnit.startsWith('пар')
        ? 'пара'
        : rawUnit.startsWith('упак')
          ? 'упак.'
          : 'шт.';
  return {
    name: match[1].trim(),
    annualNorm: Math.max(1, Number(match[2]) || 1),
    unit,
    wearMonths: Math.max(1, Number(match[4]) || 12),
    basis766n: 'Приказ Минтруда № 766н'
  };
}

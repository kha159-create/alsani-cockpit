import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';

// Note: For XLSX file support, the script is dynamically loaded in a useEffect hook.

function normalizeDate(value) {
    if (!value) return null;

    // إذا كان رقم (Excel serial)
    if (typeof value === 'number') {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + value * 86400 * 1000);
        return date.toISOString().split("T")[0];
    }

    // إذا كان نص ISO جاهز
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }

    // إذا كان نص dd/mm/yyyy أو dd-mm-yyyy أو dd.mm.yyyy
    const parts = value.split(/[\/\-.]/);
    if (parts.length === 3) {
        let [d, m, y] = parts;
        if (y.length === 2) y = "20" + y; // 25 → 2025
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    // إذا كان نص فيه أسماء شهور
    const tryDate = new Date(value);
    if (!isNaN(tryDate.getTime())) {
        return tryDate.toISOString().split("T")[0];
    }

    return null;
}

// --- Hardcoded Firebase & Gemini Config ---
const firebaseConfig = {
    apiKey: "AIzaSyC-1HPqfUOfGyjT6WXhDdYLqUwji46-UXw",
    authDomain: "alsani-cockpit-v2-cfc05.firebaseapp.com",
    projectId: "alsani-cockpit-v2-cfc05",
    storageBucket: "alsani-cockpit-v2-cfc05.appspot.com",
    messagingSenderId: "520541155010",
    appId: "1:520541155010:web:63d6df53452acc8ff7555b",
    measurementId: "G-3EG4JS9P3Y"
};
const GEMINI_API_KEY = "AIzaSyBiNm2Wh7Dpo6VJrUXYTsYdHLvS3Cv7hqk";


// --- Error Boundary ---
class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error("ErrorBoundary caught an error", error, errorInfo); }
    render() {
        if (this.state.hasError) {
            return <div className="p-4 text-center text-red-500 bg-red-100 rounded-lg">An unexpected error occurred. Please refresh the page.</div>;
        }
        return this.props.children;
    }
}

// --- Utility Functions ---
const getCategory = (product) => {
    const name = product.name || '';
    const alias = String(product.alias || '');
    const ln = name.toLowerCase();
    
    const topperAliases = ['9300', '9605', '9183', '9421', '9606'];
    
    if (topperAliases.includes(alias)) return 'Toppers';
    if (ln.includes('pillow') && !ln.includes('pillow case')) return 'Pillows';
    if (ln.includes('duvet') || ln.includes('comforter')) return 'Duvets';
    
    return 'Other';
};

// --- SVG Icons (Defined early to be available for all components) ---
const IconWrapper = ({ children, className = "h-6 w-6" }) => <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">{children}</svg>;
const HomeIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></IconWrapper>;
const OfficeBuildingIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m-1 4h1m5-8h1m-1 4h1m-1 4h1M4 21V5a2 2 0 012-2h12a2 2 0 012 2v16" /></IconWrapper>;
const UserGroupIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></IconWrapper>;
const CubeIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" /></IconWrapper>;
const PlusIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></IconWrapper>;
const PencilIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></IconWrapper>;
const TrashIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></IconWrapper>;
const PlusCircleIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></IconWrapper>;
const UploadIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></IconWrapper>;
const ChartBarIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></IconWrapper>;
const DuvetIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M19 3v4M17 5h4M5 21v-4M3 19h4M19 21v-4M17 19h4M12 5v14M5 12h14" /></IconWrapper>;
const CalculatorIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m-6 4h6m-6 4h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /></IconWrapper>;
const SparklesIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M5 17v4M3 19h4M12 3l1.09 2.22L15.31 6l-1.85 1.58L15 10l-2.6-1.8L9.8 10l1.05-2.42L9 6l2.22-.78L12 3zm0 14l-1.09-2.22L8.69 14l1.85-1.58L9 10l2.6 1.8L14.2 10l-1.05 2.42L15 14l-2.22.78L12 17z" /></IconWrapper>;
const CogIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></IconWrapper>;
const ArrowUpIcon = () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" /></svg>;
const ArrowDownIcon = () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>;
const ArrowLeftIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></IconWrapper>;
const MenuIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></IconWrapper>;
const XIcon = () => <IconWrapper><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></IconWrapper>;


// --- Reusable UI Components (Defined before pages) ---
const MonthYearFilter = ({ dateFilter, setDateFilter, allData }) => {
    const years = useMemo(() => {
        const yearSet = new Set();
        allData.forEach(d => {
            const dateStr = d.date || d['Bill Dt.'];
            if (dateStr) {
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    yearSet.add(date.getUTCFullYear());
                }
            }
        });
        const currentYear = new Date().getFullYear();
        yearSet.add(currentYear);
        const validYears = Array.from(yearSet).filter(y => !isNaN(y));
        return ['all', ...validYears.sort((a, b) => b - a)];
    }, [allData]);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['all', ...Array.from({ length: 31 }, (_, i) => i + 1)];

    const handleYearChange = (e) => {
        const year = e.target.value === 'all' ? 'all' : Number(e.target.value);
        setDateFilter(prev => ({ ...prev, year }));
    };

    const handleMonthChange = (e) => {
        const month = e.target.value === 'all' ? 'all' : Number(e.target.value);
        setDateFilter(prev => ({ ...prev, month }));
    };

    const handleDayChange = (e) => {
        const day = e.target.value === 'all' ? 'all' : Number(e.target.value);
        setDateFilter(prev => ({ ...prev, day }));
    };

    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-600">Year:</span>
                <select value={dateFilter.year} onChange={handleYearChange} className="input w-32">
                    {years.map(y => <option key={y} value={y}>{y === 'all' ? 'All' : y}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-600">Month:</span>
                <select value={dateFilter.month} onChange={handleMonthChange} className="input w-32">
                    <option value="all">All</option>
                    {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-600">Day:</span>
                <select value={dateFilter.day} onChange={handleDayChange} className="input w-32">
                    {days.map(d => <option key={d} value={d}>{d === 'all' ? 'All' : d}</option>)}
                </select>
            </div>
        </div>
    );
};
const NavItem = ({ icon, label, name, activeTab, setActiveTab, setIsSidebarOpen }) => { 
    const isActive = activeTab === name; 
    const handleClick = () => {
        setActiveTab(name);
        if (setIsSidebarOpen) {
            setIsSidebarOpen(false);
        }
    };
    return (<li onClick={handleClick} className={`flex items-center p-3 my-1.5 rounded-lg cursor-pointer transition-colors ${isActive ? 'bg-orange-100 text-orange-600 font-semibold' : 'text-zinc-600 hover:bg-gray-100'}`}>{icon}<span className="ml-4">{label}</span></li>); 
};
const ComparisonCard = ({ title, current, previous, isPercentage = false }) => { const format = (val) => { if (typeof val !== 'number') return isPercentage ? '0.0%' : '0'; if (isPercentage) return `${val.toFixed(1)}%`; return val.toLocaleString('en-US', { maximumFractionDigits: 0 }); }; const difference = current - previous; const percentageChange = previous !== 0 ? (difference / Math.abs(previous)) * 100 : current > 0 ? 100 : 0; const isPositive = difference >= 0; return (<div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200"><p className="text-sm font-medium text-zinc-500">{title}</p><div className="mt-2 flex items-baseline gap-4"><p className="text-2xl font-semibold text-zinc-900">{format(current)}</p><div className={`flex items-center text-sm font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>{percentageChange !== 0 && (isPositive ? <ArrowUpIcon /> : <ArrowDownIcon />)}<span>{Math.abs(percentageChange).toFixed(1)}%</span></div></div><p className="text-xs text-zinc-400 mt-1">vs {format(previous)} last year</p></div>); };
const KPICard = ({ title, value, format }) => (<div className="kpi-card bg-white p-5 rounded-xl shadow-sm border border-gray-200"><p className="text-sm font-semibold text-zinc-600">{title}</p><p className="text-3xl font-bold text-zinc-900 truncate">{format && typeof value === 'number' ? format(value) : (value || 0)}</p></div>);
const ChartCard = ({ title, children }) => (<div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200"><div className="text-xl font-semibold text-zinc-800 mb-4">{title}</div><div className="h-72">{children}</div></div>);
const BarChart = ({ data, dataKey, nameKey, format }) => { if (!data || data.length === 0) return <div className="flex items-center justify-center h-full text-zinc-500">No data to display</div>; const maxValue = Math.max(...data.map(item => item[dataKey] || 0)); if (maxValue === 0) return <div className="flex items-center justify-center h-full text-zinc-500">No data to display</div>; return (<div className="w-full h-full flex flex-col space-y-2 pr-4">{data.map((item, index) => (<div key={index} className="flex items-center group"><div className="w-40 text-sm text-zinc-600 truncate text-left pr-2">{item[nameKey]}</div><div className="flex-grow bg-gray-200 rounded-full h-6"><div className="bg-gradient-to-r from-orange-400 to-orange-500 h-6 rounded-full text-white text-xs flex items-center justify-end pr-2 font-semibold" style={{ width: `${((item[dataKey] || 0) / maxValue) * 100}%` }}><span>{format ? format(item[dataKey]) : item[dataKey]}</span></div></div></div>))}</div>); };
const LineChart = ({ data }) => {
    if (!data || data.length < 2) return <div className="flex items-center justify-center h-full text-zinc-500">Not enough data for a trend line.</div>;
    const svgRef = useRef(null);
    const [tooltip, setTooltip] = useState(null);
    const width = 500;
    const height = 288;
    const margin = { top: 20, right: 20, bottom: 30, left: 50 };
    const xMax = width - margin.left - margin.right;
    const yMax = height - margin.top - margin.bottom;

    const { xScale, yScale, validData } = useMemo(() => {
        const filteredData = data.filter(d => d.date && !isNaN(new Date(d.date)));
        if (filteredData.length < 2) return { validData: [], xScale: null, yScale: null };

        const dates = filteredData.map(d => new Date(`${d.date}T00:00:00Z`).getTime());
        const sales = filteredData.map(d => d.sales);
        return {
            validData: filteredData,
            xScale: { min: Math.min(...dates), max: Math.max(...dates) },
            yScale: { min: 0, max: Math.max(...sales) }
        };
    }, [data]);
    
    const getCoords = useCallback((d) => {
        if (!xScale || !yScale) return { x: 0, y: 0 };
        const domain = xScale.max - xScale.min;
        if (domain === 0) return { x: xMax / 2, y: yMax - ((d.sales - yScale.min) / (yScale.max - yScale.min)) * yMax };

        const x = ((new Date(`${d.date}T00:00:00Z`).getTime() - xScale.min) / domain) * xMax;
        const y = yMax - ((d.sales - yScale.min) / (yScale.max - yScale.min)) * yMax;
        return { x, y };
    }, [xScale, yScale, xMax, yMax]);

    const path = useMemo(() => {
        if (!validData || validData.length === 0) return '';
        return validData.map(d => getCoords(d)).map((p, i) => i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`).join(' ');
    }, [validData, getCoords]);
    
    const handleMouseMove = (e) => {
        if (!svgRef.current || validData.length === 0) return;
        const svg = svgRef.current;
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - margin.left;
        const index = Math.min(validData.length - 1, Math.max(0, Math.round((mouseX / xMax) * (validData.length - 1))));
        const point = validData[index];
        if (point) {
            const { x, y } = getCoords(point);
            setTooltip({ ...point, x: x + margin.left, y: y + margin.top });
        }
    };

    const handleMouseLeave = () => setTooltip(null);
    if (!xScale) return <div className="flex items-center justify-center h-full text-zinc-500">Not enough valid data for a trend line.</div>;
    return (<div className="relative h-full w-full"><svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} className="w-full h-full"><g transform={`translate(${margin.left}, ${margin.top})`}><path d={path} fill="none" stroke="#F97316" strokeWidth="2" /><line x1="0" y1={yMax} x2={xMax} y2={yMax} stroke="#D1D5DB" /><line x1="0" y1="0" x2="0" y2={yMax} stroke="#D1D5DB" /></g></svg>{tooltip && <div className="absolute p-2 bg-white rounded-md shadow-lg text-sm" style={{ left: tooltip.x, top: tooltip.y - 50, pointerEvents: 'none' }}><p className="font-bold">{new Date(`${tooltip.date}T00:00:00Z`).toLocaleDateString('en-CA')}</p><p>Sales: {tooltip.sales.toLocaleString()}</p></div>}</div>);
};
const PieChart = ({ data }) => { if (!data || data.length === 0) return <div className="flex items-center justify-center h-full text-zinc-500">No data to display</div>; const totalSales = data.reduce((sum, item) => sum + (item.totalSales || item.value), 0); if (totalSales === 0) return <div className="flex items-center justify-center h-full text-zinc-500">No sales data.</div>; let cumulativePercent = 0; const colors = ['#F97316', '#FB923C', '#FDBA74', '#FECACA', '#FED7AA']; const segments = data.slice(0, 5).map((item, index) => { const itemSales = item.totalSales || item.value || 0; const percent = (itemSales / totalSales); const startAngle = cumulativePercent * 360; const endAngle = (cumulativePercent + percent) * 360; cumulativePercent += percent; return { ...item, percent, startAngle, endAngle, color: colors[index % colors.length] }; }); const getCoords = (angle) => [50 + 40 * Math.cos(angle * Math.PI / 180), 50 + 40 * Math.sin(angle * Math.PI / 180)]; return (<div className="flex items-center h-full"><svg viewBox="0 0 100 100" className="w-1/2 h-full">{segments.map(seg => { const [startX, startY] = getCoords(seg.startAngle); const [endX, endY] = getCoords(seg.endAngle); const largeArcFlag = seg.percent > 0.5 ? 1 : 0; const pathData = `M 50,50 L ${startX},${startY} A 40,40 0 ${largeArcFlag},1 ${endX},${endY} z`; return <path key={seg.id || seg.name} d={pathData} fill={seg.color} />; })}</svg><div className="w-1/2 pl-4 space-y-2">{segments.map(seg => (<div key={seg.id || seg.name} className="flex items-center text-sm"><span className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: seg.color }}></span><span className="font-semibold">{seg.name}</span><span className="ml-auto text-zinc-500">{(seg.percent * 100).toFixed(1)}%</span></div>))}</div></div>); };
const DataTable = ({ columns, data }) => { if (!data || data.length === 0) return <div className="text-zinc-500 text-center py-8">No data found.</div>; return (<div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-50"><tr>{columns.map(col => <th key={col.key} className="th">{col.label}</th>)}</tr></thead><tbody className="bg-white divide-y divide-gray-200">{data.map((row, index) => (<tr key={row.id || index}>{columns.map(col => <td key={`${row.id}-${col.key}`} className="td">{col.render ? col.render(row) : (col.format ? col.format(row[col.key]) : row[col.key])}</td>)}</tr>))}</tbody></table></div>); };

// --- Skeleton Loaders ---
const KPICardSkeleton = () => (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
        <div className="h-8 bg-gray-200 rounded w-1/2"></div>
    </div>
);
const ChartCardSkeleton = () => (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="h-64 bg-gray-200 rounded"></div>
    </div>
);
const TableSkeleton = () => (
    <div className="space-y-2 animate-pulse p-4">
        <div className="h-8 bg-gray-200 rounded"></div>
        {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
        ))}
    </div>
);
const DashboardSkeleton = () => (
    <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="h-10 bg-gray-200 rounded-full w-96 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {[...Array(5)].map((_, i) => <KPICardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <ChartCardSkeleton />
            <ChartCardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <ChartCardSkeleton />
            <ChartCardSkeleton />
        </div>
    </div>
);


// --- Modals ---
const EmployeeModal = ({ data, onSave, onClose, isProcessing, stores }) => { const [name, setName] = useState(data?.name || ''); const [store, setStore] = useState(data?.store || ''); const [target, setTarget] = useState(data?.target || 0); const [duvetTarget, setDuvetTarget] = useState(data?.duvetTarget || 0); const handleSubmit = (e) => { e.preventDefault(); onSave({ id: data?.id, name, store, target: Number(target), duvetTarget: Number(duvetTarget) }); }; return (<div className="modal-content"><h2 className="modal-title">{data ? 'Edit Employee' : 'Add Employee'}</h2><form onSubmit={handleSubmit}><div className="space-y-4"><div><label className="label">Employee Name (e.g., 1234-First Last)</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="input" /></div><div><label className="label">Store</label><select value={store} onChange={e => setStore(e.target.value)} required className="input"><option value="">Select a store</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div><div><label className="label">Monthly Sales Target</label><input type="number" value={target} onChange={e => setTarget(e.target.value)} required className="input" /></div><div><label className="label">Monthly Duvet Unit Target</label><input type="number" value={duvetTarget} onChange={e => setDuvetTarget(Number(e.target.value))} required className="input" /></div></div><div className="modal-actions"><button type="button" onClick={onClose} disabled={isProcessing} className="btn-secondary">Cancel</button><button type="submit" disabled={isProcessing} className="btn-primary">{isProcessing ? 'Saving...' : 'Save'}</button></div></form></div>); };
const StoreModal = ({ data, onSave, onClose, isProcessing }) => { const [name, setName] = useState(data?.name || ''); const [target, setTarget] = useState(data?.target || 0); const handleSubmit = (e) => { e.preventDefault(); onSave({ id: data?.id, name, target: Number(target) }); }; return (<div className="modal-content"><h2 className="modal-title">{data ? 'Edit Store' : 'Add Store'}</h2><form onSubmit={handleSubmit}><div className="space-y-4"><div><label className="label">Store Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="input" /></div><div><label className="label">Monthly Sales Target</label><input type="number" value={target} onChange={e => setTarget(e.target.value)} required className="input" /></div></div><div className="modal-actions"><button type="button" onClick={onClose} disabled={isProcessing} className="btn-secondary">Cancel</button><button type="submit" disabled={isProcessing} className="btn-primary">{isProcessing ? 'Saving...' : 'Save'}</button></div></form></div>); };
const ProductModal = ({ data, onSave, onClose, isProcessing }) => { const [name, setName] = useState(data?.name || ''); const [alias, setAlias] = useState(data?.alias || ''); const [price, setPrice] = useState(data?.price || ''); const handleSubmit = (e) => { e.preventDefault(); onSave({ id: data?.id, name, alias, price: Number(price) }); }; return (<div className="modal-content"><h2 className="modal-title">{data ? 'Edit Product' : 'Add Product'}</h2><form onSubmit={handleSubmit} className="space-y-4"><div><label className="label">Product Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} required className="input" /></div><div><label className="label">Product Alias</label><input type="text" value={alias} onChange={e => setAlias(e.target.value)} required className="input" /></div><div><label className="label">Price</label><input type="number" value={price} onChange={e => setPrice(e.target.value)} required className="input" /></div><div className="modal-actions"><button type="button" onClick={onClose} disabled={isProcessing} className="btn-secondary">Cancel</button><button type="submit" disabled={isProcessing} className="btn-primary">{isProcessing ? 'Saving...' : 'Save'}</button></div></form></div>) };
const DailyMetricModal = ({ data, onSave, onClose, isProcessing, stores }) => { const { mode, store: initialStore, employee: initialEmployee } = data; const [date, setDate] = useState(new Date().toISOString().split('T')[0]); const [store, setStore] = useState(initialStore || ''); const [employee] = useState(initialEmployee || ''); const [totalSales, setTotalSales] = useState(''); const [visitors, setVisitors] = useState(''); const [transactionCount, setTransactionCount] = useState(''); const atv = useMemo(() => { const sales = Number(totalSales); const trans = Number(transactionCount); return trans > 0 ? (sales / trans).toFixed(2) : '0.00'; }, [totalSales, transactionCount]); const visitorRate = useMemo(() => { const trans = Number(transactionCount); const v = Number(visitors); return v > 0 ? ((trans / v) * 100).toFixed(2) : '0.00'; }, [transactionCount, visitors]); const handleSubmit = (e) => { e.preventDefault(); const metricData = { date, store, totalSales: Number(totalSales), transactionCount: Number(transactionCount), atv: Number(atv) }; if (mode === 'store') { metricData.visitors = Number(visitors); metricData.visitorRate = Number(visitorRate); } else { metricData.employee = employee; } onSave(metricData); }; return (<div className="modal-content"><h2 className="modal-title">Add Daily KPIs</h2><form onSubmit={handleSubmit} className="space-y-4"><div><label className="label">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} required className="input" /></div>{mode === 'employee' ? (<p className="p-2 bg-gray-100 rounded text-center">For: <strong>{employee}</strong> at <strong>{store}</strong></p>) : (<div><label className="label">Store</label><select value={store} onChange={e => setStore(e.target.value)} required className="input"><option value="">Select a store</option>{stores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div>)}<div><label className="label">Total Sales for the Day</label><input type="number" value={totalSales} onChange={e => setTotalSales(e.target.value)} required className="input" /></div><div><label className="label">Number of Bills</label><input type="number" value={transactionCount} onChange={e => setTransactionCount(e.target.value)} required className="input" /></div><div className="p-2 bg-gray-50 rounded-md text-sm">Calculated ATV: <span className="font-bold">{atv}</span></div>{mode === 'store' && (<><div><label className="label">Total Visitors</label><input type="number" value={visitors} onChange={e => setVisitors(e.target.value)} required className="input" /></div><div className="p-2 bg-gray-50 rounded-md text-sm">Calculated Visitor Rate: <span className="font-bold">{visitorRate}%</span></div></>)}<div className="modal-actions"><button type="button" onClick={onClose} disabled={isProcessing} className="btn-secondary">Cancel</button><button type="submit" disabled={isProcessing} className="btn-primary">{isProcessing ? 'Saving...' : 'Save KPIs'}</button></div></form></div>); };
const AppMessageModal = ({ message, onClose }) => (
    <div className="modal-backdrop">
        <div className="modal-content text-center">
            <h3 className="modal-title">{message.type === 'confirm' ? 'Confirmation' : 'Alert'}</h3>
            <p>{message.text}</p>
            <div className="modal-actions justify-center">
                {message.type === 'confirm' && (
                    <button onClick={() => { message.onConfirm(); onClose(); }} className="btn-primary">Confirm</button>
                )}
                <button onClick={onClose} className="btn-secondary">Close</button>
            </div>
        </div>
    </div>
);
const AiCoachingModal = ({ data: employee, geminiFetch, onClose }) => {
    const [analysis, setAnalysis] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const generateAnalysis = async () => {
            try {
                const atv = employee.totalTransactions > 0 ? employee.totalSales / employee.totalTransactions : 0;
                const newTotalSales = (atv + 25) * employee.totalTransactions;

                const prompt = `
أنت مدرب مبيعات محترف ومحفز. مهمتك هي تقديم نصائح تدريبية مخصصة لموظف بيع بالتجزئة بناءً على أرقام أدائه.

**بيانات الموظف "${employee.name}":**
- إجمالي المبيعات: ${employee.totalSales.toLocaleString()} ريال
- عدد الفواتير: ${employee.totalTransactions.toLocaleString()}
- متوسط قيمة الفاتورة (ATV): ${atv.toLocaleString()} ريال

**المطلوب:**
1.  **رسالة إيجابية:** ابدأ بفقرة قصيرة تشيد فيها بجهد الموظف.
2.  **قوة متوسط الفاتورة:** وضح للموظف الأثر الكبير لزيادة بسيطة في متوسط الفاتورة. استخدم هذه الجملة بالضبط: "تخيل أثر الزيادة البسيطة! لو تمكنت من زيادة متوسط فاتورتك بمقدار 25 ريالاً فقط، لقفزت مبيعاتك الإجمالية من ${employee.totalSales.toLocaleString()} إلى ${newTotalSales.toLocaleString()} ريال."
3.  **نصائح عملية:** قدم نصيحتين عمليتين ومحددتين في أساليب البيع (مثل البيع المتقاطع والبيع الإضافي) لمساعدته على تحقيق هذه الزيادة.

اجعل الأسلوب ودوداً ومباشراً ومحفزاً. استخدم تنسيق الماركداون.
`;
                const result = await geminiFetch({ contents: [{ parts: [{ text: prompt }] }] });
                setAnalysis(result);
            } catch (error) {
                console.error("AI coaching failed:", error);
                setAnalysis("عذراً، لم أتمكن من إنشاء ملخص الأداء. يرجى المحاولة مرة أخرى.");
            } finally {
                setIsLoading(false);
            }
        };

        if (employee) {
            generateAnalysis();
        }
    }, [employee, geminiFetch]);

    return (
        <div className="modal-content">
            <h2 className="modal-title flex items-center gap-2">
                <SparklesIcon /> نصائح تدريبية لـ {employee.name}
            </h2>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
                {isLoading ? (
                    <div className="text-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div>
                        <p className="mt-2 text-zinc-600">...جاري إعداد النصائح</p>
                    </div>
                ) : (
                    <div className="prose" dangerouslySetInnerHTML={{ __html: analysis.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }}></div>
                )}
            </div>
            <div className="modal-actions">
                <button onClick={onClose} className="btn-secondary">إغلاق</button>
            </div>
        </div>
    );
};
const SalesForecastModal = ({ salesData, geminiFetch, onClose }) => {
    const [forecast, setForecast] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const generateForecast = async () => {
            if (!salesData || salesData.length < 2) {
                setForecast("Not enough data to generate a forecast.");
                setIsLoading(false);
                return;
            }

            try {
                const simplifiedData = salesData.map(d => `Date: ${d.date}, Sales: ${d.sales.toFixed(0)}`).join('\n');
                
                const prompt = `
أنت محلل بيانات خبير في قطاع التجزئة. بناءً على بيانات المبيعات اليومية التالية، قدم تحليلاً موجزاً وتوقعاً للمبيعات للأيام السبعة القادمة.

**البيانات:**
${simplifiedData}

**التعليمات:**
1.  **تحليل الاتجاه العام:** صف باختصار اتجاه المبيعات (مثلاً: تصاعدي، تنازلي، مستقر، متقلب).
2.  **تقديم توقع:** أعطِ توقعاً بسيطاً ومقدراً للمبيعات خلال الأيام السبعة المقبلة.
3.  **نصيحة عملية:** قدم نصيحة واحدة عملية بناءً على الاتجاه العام، إما للاستفادة من النمو أو لتقليل أثر التراجع.

حافظ على لغة واضحة وموجزة ومهنية. استخدم تنسيق الماركداون.
`;

                const result = await geminiFetch({ contents: [{ parts: [{ text: prompt }] }] });
                setForecast(result);
            } catch (error) {
                console.error("Sales forecast failed:", error);
                setForecast("Sorry, I was unable to generate a sales forecast. Please try again later.");
            } finally {
                setIsLoading(false);
            }
        };

        generateForecast();
    }, [salesData, geminiFetch]);

    return (
        <div className="modal-content">
            <h2 className="modal-title flex items-center gap-2">
                <SparklesIcon /> Sales Forecast & Analysis
            </h2>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
                {isLoading ? (
                    <div className="text-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div>
                        <p className="mt-2 text-zinc-600">Generating forecast...</p>
                    </div>
                ) : (
                    <div className="prose" dangerouslySetInnerHTML={{ __html: forecast.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }}></div>
                )}
            </div>
            <div className="modal-actions">
                <button onClick={onClose} className="btn-secondary">Close</button>
            </div>
        </div>
    );
};
const SalesPitchModal = ({ product, geminiFetch, onClose }) => {
    const [pitch, setPitch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const generatePitch = async () => {
            if (!product) {
                setPitch("Product information is missing.");
                setIsLoading(false);
                return;
            }

            try {
                const prompt = `
أنت مدرب مبيعات خبير في شركة للمستلزمات المنزلية. قم بإنشاء نص بيعي قصير ومقنع للمنتج التالي.

**معلومات المنتج:**
- **الاسم:** ${product.name}
- **الفئة:** ${getCategory(product)}
- **السعر:** ${product.price.toLocaleString('ar-SA', { style: 'currency', currency: 'SAR' })}

**التعليمات:**
1.  **جملة افتتاحية:** ابدأ بسؤال أو عبارة لجذب انتباه العميل.
2.  **أبرز ميزتين رئيسيتين:** ركز على الفوائد (مثل الراحة، نوم أفضل، إحساس بالرفاهية) وليس فقط الخصائص.
3.  **جملة ختامية:** اختتم بعبارة بسيطة لتشجيع العميل على الشراء.

يجب أن يكون النص باللغة العربية، ودودًا، وسهل الحفظ والاستخدام من قبل البائع. استخدم تنسيق الماركداون.
`;

                const result = await geminiFetch({ contents: [{ parts: [{ text: prompt }] }] });
                setPitch(result);
            } catch (error) {
                console.error("Sales pitch generation failed:", error);
                setPitch("Sorry, I was unable to generate a sales pitch. Please try again later.");
            } finally {
                setIsLoading(false);
            }
        };

        generatePitch();
    }, [product, geminiFetch]);

    return (
        <div className="modal-content">
            <h2 className="modal-title flex items-center gap-2">
                <SparklesIcon /> Sales Pitch for {product.name}
            </h2>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
                {isLoading ? (
                    <div className="text-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div>
                        <p className="mt-2 text-zinc-600">Generating pitch...</p>
                    </div>
                ) : (
                    <div className="prose" dangerouslySetInnerHTML={{ __html: pitch.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }}></div>
                )}
            </div>
            <div className="modal-actions">
                <button onClick={onClose} className="btn-secondary">Close</button>
            </div>
        </div>
    );
};


// --- Page Components ---
const Dashboard = ({ isLoading, kpiData, storeSummary, topEmployeesByAchievement, dateFilter, setDateFilter, salesOverTimeData, allProducts, allData, setModalState }) => {
    
    const productPerformance = useMemo(() => {
        const top5 = [...allProducts].sort((a, b) => (b.soldQty * b.price) - (a.soldQty * a.price)).slice(0, 5);
        
        const salesByCategory = allProducts.reduce((acc, product) => {
            const category = getCategory(product);
            const salesValue = (product.soldQty || 0) * (product.price || 0);
            acc[category] = (acc[category] || 0) + salesValue;
            return acc;
        }, {});
        
        const categoryData = Object.entries(salesByCategory).map(([name, totalSales]) => ({ name, value: totalSales }));

        return { top5, categoryData };
    }, [allProducts]);

    if (isLoading) {
        return <DashboardSkeleton />;
    }
    
    return (
        <div className="space-y-6">
            <MonthYearFilter dateFilter={dateFilter} setDateFilter={setDateFilter} allData={allData} />
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
                <KPICard title="Total Sales" value={kpiData.totalSales} format={val => val.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
                <KPICard title="Total Transactions" value={kpiData.totalTransactions} format={val => val.toLocaleString('en-US')} />
                <KPICard title="Avg. Transaction Value" value={kpiData.averageTransactionValue} format={val => val.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
                <KPICard title="Conversion Rate" value={kpiData.conversionRate} format={v => `${v.toFixed(1)}%`} />
                <KPICard title="Sales Per Visitor" value={kpiData.salesPerVisitor} format={val => val.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                 <div className="lg:col-span-3">
                    <ChartCard title={
                        <div className="flex justify-between items-center">
                            <span>Sales Over Time</span>
                            <button 
                                onClick={() => setModalState({ type: 'salesForecast', data: salesOverTimeData })}
                                className="btn-secondary text-sm flex items-center gap-1 py-1 px-2"
                                title="Get AI Sales Forecast"
                            >
                                <SparklesIcon /> Get Forecast
                            </button>
                        </div>
                      }>
                        <LineChart data={salesOverTimeData} />
                    </ChartCard>
                </div>
                <div className="lg:col-span-2"><ChartCard title="Sales by Store"><PieChart data={storeSummary} /></ChartCard></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                <div className="lg:col-span-3"><ChartCard title="Top 5 Products by Sales Value"><BarChart data={productPerformance.top5.map(p => ({ ...p, value: p.soldQty * p.price }))} dataKey="value" nameKey="name" format={val => val.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} /></ChartCard></div>
                <div className="lg:col-span-2"><ChartCard title="Sales by Category"><PieChart data={productPerformance.categoryData} /></ChartCard></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <ChartCard title="Top Stores by Target Achievement %"><BarChart data={[...storeSummary].sort((a, b) => b.targetAchievement - a.targetAchievement).slice(0, 10)} dataKey="targetAchievement" nameKey="name" format={val => `${val.toFixed(1)}%`} /></ChartCard>
                <ChartCard title="Top Employees by Target Achievement %"><BarChart data={topEmployeesByAchievement} dataKey="achievement" nameKey="name" format={val => `${val.toFixed(1)}%`} /></ChartCard>
            </div>
        </div>
    );
};
const ProductsPage = ({ allProducts, dateFilter, setDateFilter, allData, setModalState }) => {
    const [filters, setFilters] = useState({ name: '', alias: '', category: 'All', priceRange: 'All' });
    const filtered = useMemo(() => allProducts.filter(p =>
        (p.name?.toLowerCase() || '').includes(filters.name.toLowerCase()) &&
        (p.alias?.toLowerCase() || '').includes(filters.alias.toLowerCase()) &&
        (filters.category === 'All' || getCategory(p) === filters.category) &&
        (filters.priceRange === 'All' || (filters.priceRange === '<150' && p.price < 150) || (filters.priceRange === '150-500' && p.price >= 150 && p.price <= 500) || (filters.priceRange === '>500' && p.price > 500))
    ), [allProducts, filters]);

    const columns = [
        { key: 'name', label: 'Product Name' },
        { key: 'alias', label: 'Item Alias' },
        { key: 'soldQty', label: 'Sold Qty' },
        { key: 'price', label: 'Item Rate', format: val => typeof val === 'number' ? val.toLocaleString('en-US') : 'N/A' },
        {
            key: 'actions',
            label: 'Actions',
            render: (product) => (
                <button
                    onClick={() => setModalState({ type: 'salesPitch', data: product })}
                    className="text-orange-500 hover:text-orange-700"
                    title="✨ Get AI Sales Pitch"
                >
                    <SparklesIcon />
                </button>
            )
        }
    ];

    return (
        <div className="space-y-6">
            <MonthYearFilter dateFilter={dateFilter} setDateFilter={setDateFilter} allData={allData} />
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-semibold text-zinc-700">All Products</h3></div>
                <div className="flex flex-wrap gap-4 mb-4 items-center p-4 bg-gray-50 rounded-lg">
                    <input type="text" placeholder="Filter by Product Name..." value={filters.name} onChange={e => setFilters(prev => ({ ...prev, name: e.target.value }))} className="input flex-grow min-w-[200px]" />
                    <input type="text" placeholder="Filter by Item Alias..." value={filters.alias} onChange={e => setFilters(prev => ({ ...prev, alias: e.target.value }))} className="input flex-grow min-w-[200px]" />
                    <select value={filters.category} onChange={e => setFilters(prev => ({ ...prev, category: e.target.value }))} className="input flex-grow min-w-[150px]"><option value="All">All Categories</option><option value="Duvets">Duvets</option><option value="Pillows">Pillows</option><option value="Toppers">Toppers</option><option value="Other">Other</option></select>
                    <select value={filters.priceRange} onChange={e => setFilters(prev => ({ ...prev, priceRange: e.target.value }))} className="input flex-grow min-w-[150px]"><option value="All">All Prices</option><option value="<150">&lt; 150</option><option value="150-500">150 - 500</option><option value=">500">&gt; 500</option></select>
                </div>
                <DataTable columns={columns} data={filtered} />
            </div>
        </div>
    );
};
const StoresPage = ({ isLoading, storeSummary, onAddSale, onAddStore, onEditStore, onDeleteStore, onSelectStore, dateFilter, setDateFilter, allData }) => (
    <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-4">
            <MonthYearFilter dateFilter={dateFilter} setDateFilter={setDateFilter} allData={allData} />
            <div className="flex justify-end gap-4">
                <button onClick={onAddSale} className="btn-green flex items-center gap-2"><PlusIcon /> Add Daily KPIs</button>
                <button onClick={onAddStore} className="btn-primary flex items-center gap-2"><PlusIcon /> Add Store</button>
            </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xl font-semibold text-zinc-800 mb-4">All Stores</h3>
            {isLoading ? <TableSkeleton /> : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="th">Store</th>
                                <th className="th">Total Sales</th>
                                <th className="th">Target</th>
                                <th className="th">Achievement</th>
                                <th className="th">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {storeSummary.map(store => (
                                <tr key={store.id}>
                                    <td className="td font-medium"><span className="cursor-pointer text-blue-600 hover:underline" onClick={() => onSelectStore(store)}>{store.name}</span></td>
                                    <td className="td">{store.totalSales.toLocaleString()}</td>
                                    <td className="td">{store.target?.toLocaleString() || 'N/A'}</td>
                                    <td className="td">
                                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                                            <div className="bg-blue-500 h-2.5 rounded-full" style={{ width: `${Math.min(store.targetAchievement, 100)}%` }}></div>
                                        </div>
                                        <span>{store.targetAchievement.toFixed(1)}%</span>
                                    </td>
                                    <td className="td space-x-2">
                                        <button onClick={() => onEditStore(store)} className="text-blue-600"><PencilIcon /></button>
                                        <button onClick={() => onDeleteStore(store.id)} className="text-red-600"><TrashIcon /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    </div>
);
const Employee360View = ({ employee, allMetrics, salesTransactions, kingDuvetSales, storeSummary }) => {
    const employeeData = useMemo(() => {
        const metrics = allMetrics.filter(m => m.employee === employee.name);
        
        const totalSales = metrics.reduce((sum, m) => sum + (m.totalSales || 0), 0);
        const totalTransactions = metrics.reduce((sum, m) => sum + (m.transactionCount || 0), 0);
        const atv = totalTransactions > 0 ? totalSales / totalTransactions : 0;
        const achievement = employee.target > 0 ? (totalSales / employee.target) * 100 : 0;

        const store = storeSummary.find(s => s.name === employee.store);
        const storeTotalSales = store ? store.totalSales : 0;
        const contributionPercentage = storeTotalSales > 0 ? (totalSales / storeTotalSales) * 100 : 0;

        const getDuvetCategory = (price) => {
            if (price >= 199 && price <= 399) return 'Low Value (199-399)';
            if (price >= 495 && price <= 695) return 'Medium Value (495-695)';
            if (price >= 795 && price <= 999) return 'High Value (795-999)';
            return null;
        };

        const employeeDuvetSales = kingDuvetSales.filter(s => s['SalesMan Name'] === employee.name);
        
        const duvetSummary = employeeDuvetSales.reduce((acc, sale) => {
            const category = getDuvetCategory(sale['Item Rate']);
            if (category) {
                acc[category] = (acc[category] || 0) + (sale['Sold Qty'] || 0);
            }
            return acc;
        }, { 'Low Value (199-399)': 0, 'Medium Value (495-695)': 0, 'High Value (795-999)': 0 });

        const totalDuvets = Object.values(duvetSummary).reduce((sum, count) => sum + count, 0);

        const duvetCategories = [
            { name: 'Low Value (199-399)', count: duvetSummary['Low Value (199-399)'] },
            { name: 'Medium Value (495-695)', count: duvetSummary['Medium Value (495-695)'] },
            { name: 'High Value (795-999)', count: duvetSummary['High Value (795-999)'] },
        ];
        
        const combinedSales = [...salesTransactions, ...kingDuvetSales].filter(s => s['SalesMan Name'] === employee.name);
        
        const salesByCategory = combinedSales.reduce((acc, sale) => {
            const productInfo = { name: sale['Item Name'], alias: sale['Item Alias'] };
            const category = getCategory(productInfo);
            const salesValue = (sale['Sold Qty'] || 0) * (sale['Item Rate'] || 0);
            acc[category] = (acc[category] || 0) + salesValue;
            return acc;
        }, {});
        
        const categoryData = Object.entries(salesByCategory).map(([name, totalSales]) => ({ name, value: totalSales }));

        const topProducts = combinedSales.reduce((acc, sale) => {
            const name = sale['Item Name'];
            const qty = sale['Sold Qty'] || 0;
            acc[name] = (acc[name] || 0) + qty;
            return acc;
        }, {});

        const top5Products = Object.entries(topProducts)
            .sort(([, qtyA], [, qtyB]) => qtyB - qtyA)
            .slice(0, 5)
            .map(([name, soldQty]) => ({ name, soldQty }));


        return { totalSales, atv, achievement, categoryData, top5Products, contributionPercentage, duvetCategories, totalDuvets };

    }, [employee, allMetrics, salesTransactions, kingDuvetSales, storeSummary]);

    return (
        <td colSpan="6" className="p-0">
            <div className="bg-gray-50 p-4 m-2 border-l-4 border-orange-500 rounded-r-lg animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    <KPICard title="Total Sales" value={employeeData.totalSales} format={v => v.toLocaleString('en-US', {style: 'currency', currency: 'SAR'})} />
                    <KPICard title="Avg. Transaction Value" value={employeeData.atv} format={v => v.toLocaleString('en-US', {style: 'currency', currency: 'SAR'})} />
                    <KPICard title="Target Achievement" value={employeeData.achievement} format={v => `${v.toFixed(1)}%`} />
                    <KPICard title="Contribution to Store" value={employeeData.contributionPercentage} format={v => `${v.toFixed(1)}%`} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartCard title="Duvet Sales Analysis by Value">
                        <div className="space-y-3 p-2 h-full flex flex-col justify-center">
                            {employeeData.totalDuvets > 0 ? employeeData.duvetCategories.map(cat => {
                                const percentage = (cat.count / employeeData.totalDuvets) * 100;
                                return (
                                    <div key={cat.name}>
                                        <div className="flex justify-between text-sm font-medium text-zinc-600 mb-1">
                                            <span>{cat.name}</span>
                                            <span>{cat.count} units ({percentage.toFixed(1)}%)</span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-4">
                                            <div className="bg-sky-500 h-4 rounded-full" style={{ width: `${percentage}%` }}></div>
                                        </div>
                                    </div>
                                )
                            }) : <p className="text-center text-zinc-500">No duvet sales data found.</p>}
                        </div>
                    </ChartCard>
                    <ChartCard title="Sales by Product Category">
                        <PieChart data={employeeData.categoryData} />
                    </ChartCard>
                </div>
                 <div className="mt-4 bg-white p-4 rounded-lg shadow-sm">
                    <h4 className="text-lg font-semibold mb-2">Top 5 Products Sold</h4>
                     <BarChart data={employeeData.top5Products} dataKey="soldQty" nameKey="name" format={v => `${v} units`} />
                </div>
            </div>
        </td>
    );
};
const EmployeesPage = ({ isLoading, employeeSummary, onAddEmployee, onAddSale, onEditEmployee, onDeleteEmployee, setModalState, dateFilter, setDateFilter, allData, salesTransactions, kingDuvetSales, storeSummary }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

    const handleEmployeeSelect = (employeeId) => {
        setSelectedEmployeeId(prevId => (prevId === employeeId ? null : employeeId));
    };

    const handleAiCoachingClick = (employee) => {
        setModalState({ type: 'aiCoaching', data: employee });
    };

    const filteredEmployeeSummary = useMemo(() => {
        if (!searchTerm) {
            return employeeSummary;
        }
        const filtered = {};
        for (const storeName in employeeSummary) {
            const employees = employeeSummary[storeName].filter(emp =>
                emp && (emp.name || '').toLowerCase().includes(searchTerm.toLowerCase())
            );
            if (employees.length > 0) {
                filtered[storeName] = employees;
            }
        }
        return filtered;
    }, [employeeSummary, searchTerm]);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center gap-4">
                <input
                    type="text"
                    placeholder="Search for an employee..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input max-w-sm"
                />
                <button onClick={onAddEmployee} className="btn-primary flex items-center gap-2"><PlusIcon /> Add Employee</button>
            </div>
            <MonthYearFilter dateFilter={dateFilter} setDateFilter={setDateFilter} allData={allData} />
            {isLoading ? <TableSkeleton /> : Object.keys(filteredEmployeeSummary).length === 0 && !isLoading ? (
                <div className="text-center p-8 bg-white rounded-lg">No employees found.</div>
            ) : (
                Object.keys(filteredEmployeeSummary).sort().map(storeName => (
                    <div key={storeName} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h3 className="text-xl font-semibold text-zinc-800 mb-4">{storeName}</h3>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="th">Employee</th>
                                        <th className="th">Total Sales</th>
                                        <th className="th">Avg. Bill</th>
                                        <th className="th">Target</th>
                                        <th className="th">Achievement</th>
                                        <th className="th">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredEmployeeSummary[storeName] && filteredEmployeeSummary[storeName].map(employee => {
                                        const target = employee.target || 0;
                                        const achievement = target > 0 ? (employee.totalSales / target) * 100 : 0;
                                        const atv = employee.totalTransactions > 0 ? employee.totalSales / employee.totalTransactions : 0;
                                        return (
                                            <React.Fragment key={employee.id}>
                                                <tr>
                                                    <td className="td font-medium">
                                                        <span className="cursor-pointer hover:underline text-blue-600" onClick={() => handleEmployeeSelect(employee.id)}>
                                                            {employee.name}
                                                        </span>
                                                    </td>
                                                    <td className="td">{employee.totalSales.toLocaleString('en-US')}</td>
                                                    <td className="td">{atv.toLocaleString('en-US', { style: 'currency', currency: 'SAR' })}</td>
                                                    <td className="td">{target.toLocaleString('en-US')}</td>
                                                    <td className="td">
                                                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${Math.min(achievement, 100)}%` }}></div>
                                                        </div>
                                                        <span className="text-xs">{achievement.toFixed(1)}%</span>
                                                    </td>
                                                    <td className="td space-x-2">
                                                        <button onClick={() => handleAiCoachingClick(employee)} className="text-orange-500" title="Get AI Coaching Tips"><SparklesIcon /></button>
                                                        <button onClick={() => onAddSale({ mode: 'employee', store: employee.store, employee: employee.name })} className="text-green-600"><PlusCircleIcon /></button>
                                                        <button onClick={() => onEditEmployee(employee)} className="text-blue-600"><PencilIcon /></button>
                                                        <button onClick={() => onDeleteEmployee(employee.id)} className="text-red-600"><TrashIcon /></button>
                                                    </td>
                                                </tr>
                                                {selectedEmployeeId === employee.id && (
                                                     <tr>
                                                        <Employee360View 
                                                            employee={employee} 
                                                            allMetrics={allData}
                                                            salesTransactions={salesTransactions}
                                                            kingDuvetSales={kingDuvetSales}
                                                            storeSummary={storeSummary}
                                                        />
                                                     </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};
const LFLPage = ({ lflData, allStores, lflStoreFilter, setLflStoreFilter, lflMonthFilter, setLflMonthFilter }) => {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;

    return (
        <div className="space-y-8">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap justify-start items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-700">Filter by Store:</span>
                    <select value={lflStoreFilter} onChange={e => setLflStoreFilter(e.target.value)} className="input">
                        <option value="All">All Stores</option>
                        {allStores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-700">Select Month for Comparison:</span>
                    <select value={lflMonthFilter} onChange={e => setLflMonthFilter(Number(e.target.value))} className="input">
                        {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                    </select>
                </div>
            </div>

            <div>
                <h3 className="text-xl font-semibold text-zinc-800 mb-4">
                    Month over Month Comparison: {months[lflMonthFilter]} {currentYear} vs {previousYear}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                    <ComparisonCard title="Sales" current={lflData.current.totalSales} previous={lflData.previous.totalSales} />
                    <ComparisonCard title="Visitors" current={lflData.current.totalVisitors} previous={lflData.previous.totalVisitors} />
                    <ComparisonCard title="Avg. Transaction Value (ATV)" current={lflData.current.atv} previous={lflData.previous.atv} />
                    <ComparisonCard title="Transactions" current={lflData.current.totalTransactions} previous={lflData.previous.totalTransactions} />
                    <ComparisonCard title="Visitor Conversion Rate" current={lflData.current.visitorRate} previous={lflData.previous.visitorRate} isPercentage={true} />
                </div>
            </div>
        </div>
    );
};
const DuvetsPage = ({ allDuvetSales, employees, selectedEmployee, onBack }) => { const getDuvetCategory = useCallback((price) => { if (price >= 199 && price <= 399) return 'Low Value (199-399)'; if (price >= 495 && price <= 695) return 'Medium Value (495-695)'; if (price >= 795 && price <= 999) return 'High Value (795-999)'; return null; }, []); if (selectedEmployee) { const employeeDuvetSales = allDuvetSales.filter(s => s['SalesMan Name'] === selectedEmployee.name); const summary = employeeDuvetSales.reduce((acc, sale) => { const category = getDuvetCategory(sale['Item Rate']); if (category) acc[category] = (acc[category] || 0) + sale['Sold Qty']; return acc; }, {}); const total = Object.values(summary).reduce((sum, count) => sum + count, 0); const target = selectedEmployee.duvetTarget || 0; const achievement = target > 0 ? (total / target) * 100 : 0; const categories = ['Low Value (199-399)', 'Medium Value (495-695)', 'High Value (795-999)']; return (<div className="bg-white p-6 rounded-xl shadow-sm"> <button onClick={onBack} className="btn-secondary mb-4">&larr; Back to Duvet Overview</button> <h3 className="text-2xl font-bold text-zinc-800">Duvet Performance: {selectedEmployee.name}</h3> <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4"> <KPICard title="Total Duvets Sold" value={total} /> <KPICard title="Duvet Target" value={target} /> <KPICard title="Target Achievement" value={achievement} format={v => `${v.toFixed(1)}%`} /> </div> <div className="mt-6"> <h4 className="text-xl font-semibold mb-2">Sales by Category</h4> <div className="space-y-2"> {categories.map(cat => { const count = summary[cat] || 0; const percentage = total > 0 ? (count / total) * 100 : 0; return (<div key={cat}><p>{cat}: {count} units ({percentage.toFixed(1)}%)</p><div className="w-full bg-gray-200 rounded-full h-4"><div className="bg-green-500 h-4 rounded-full" style={{ width: `${percentage}%` }}></div></div></div>) })} </div> </div> </div>); } const storeDuvetSummary = allDuvetSales.reduce((acc, sale) => { const storeName = sale['Outlet Name'] || 'Unknown'; const category = getDuvetCategory(sale['Item Rate']); if (category) { if (!acc[storeName]) acc[storeName] = { name: storeName, 'Low Value (199-399)': 0, 'Medium Value (495-695)': 0, 'High Value (795-999)': 0, total: 0 }; acc[storeName][category] += sale['Sold Qty']; acc[storeName].total += sale['Sold Qty']; } return acc; }, {}); const columns = [{ key: 'name', label: 'Store' }, { key: 'Low Value (199-399)', label: 'Low Value (199-399)' }, { key: 'Medium Value (495-695)', label: 'Medium Value (495-695)' }, { key: 'High Value (795-999)', label: 'High Value (795-999)' }, { key: 'total', label: 'Total Units' }]; return (<div className="bg-white p-6 rounded-xl shadow-sm"> <h3 className="text-xl font-semibold text-zinc-800 mb-4">Duvet Sales Overview by Store</h3> <DataTable data={Object.values(storeDuvetSummary)} columns={columns} /> </div>); };
const StoreDetailPage = ({ store, allMetrics, onBack, geminiFetch, dateFilter, setDateFilter }) => {
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    const storeData = useMemo(() => {
        const yearMatch = (date) => dateFilter.year === 'all' || date.getFullYear() === dateFilter.year;
        const monthMatch = (date) => dateFilter.month === 'all' || date.getMonth() === dateFilter.month;

        const metrics = allMetrics.filter(m => {
            if (m.store !== store.name) return false;
            const parts = m.date.split('-');
            const metricDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
            return yearMatch(metricDate) && monthMatch(metricDate);
        });
        
        const totalSales = metrics.reduce((sum, m) => sum + (m.totalSales || 0), 0);
        const totalVisitors = metrics.reduce((sum, m) => sum + (m.visitors || 0), 0);
        const totalTransactions = metrics.reduce((sum, m) => sum + (m.transactionCount || 0), 0);
        const salesPerVisitor = totalVisitors > 0 ? totalSales / totalVisitors : 0;

        return {
            totalSales,
            totalVisitors,
            totalTransactions,
            atv: totalTransactions > 0 ? totalSales / totalTransactions : 0,
            visitorRate: totalVisitors > 0 ? (totalTransactions / totalVisitors) * 100 : 0,
            salesPerVisitor
        };
    }, [store, allMetrics, dateFilter]);

    const dynamicTargetData = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const todayDate = now.getDate();

        const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
        const remainingDays = totalDaysInMonth - todayDate + 1;
        
        const salesThisMonth = allMetrics
            .filter(m => {
                if (m.store !== store.name) return false;
                const parts = m.date.split('-'); // YYYY-MM-DD
                const metricDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                return metricDate.getFullYear() === year && metricDate.getMonth() === month;
            })
            .reduce((sum, m) => sum + (m.totalSales || 0), 0);
            
        const remainingTarget100 = store.target - salesThisMonth;
        const requiredDailyAverage100 = remainingDays > 0 ? Math.max(0, remainingTarget100) / remainingDays : 0;

        const target90 = store.target * 0.9;
        const remainingTarget90 = target90 - salesThisMonth;
        const requiredDailyAverage90 = remainingDays > 0 ? Math.max(0, remainingTarget90) / remainingDays : 0;

        return {
            salesMTD: salesThisMonth,
            remainingTarget: remainingTarget100,
            remainingDays,
            requiredDailyAverage: requiredDailyAverage100,
            requiredDailyAverage90: requiredDailyAverage90
        };
    }, [store.name, store.target, allMetrics]);
    
    const handleGenerateAnalysis = async () => {
        setIsAnalyzing(true);
        setAiAnalysis('');
        try {
            const prompt = `
أنت مستشار خبير في قطاع التجزئة. مهمتك هي تحليل بيانات الأداء لفرع معين وتقديم ملخص واضح وقابل للتنفيذ لمدير الفرع. كن إيجابياً ومحفزاً.

البيانات التالية تخص فرع "${store.name}":
- إجمالي المبيعات: ${storeData.totalSales.toLocaleString()} ريال
- إجمالي الزوار: ${storeData.totalVisitors.toLocaleString()}
- إجمالي الفواتير: ${storeData.totalTransactions.toLocaleString()}
- متوسط قيمة الفاتورة (ATV): ${storeData.atv.toLocaleString()} ريال
- نسبة تحويل الزوار: ${storeData.visitorRate.toFixed(1)}%
- الهدف الشهري: ${store.target.toLocaleString()} ريال
 
بناءً على هذه البيانات، قم بما يلي:
1.  **ملخص الأداء:** قدم فقرة موجزة تلخص أداء الفرع بشكل عام.
2.  **نقاط القوة:** اذكر نقطتين قوة أساسيتين تستندان إلى الأرقام (مثال: "متوسط الفاتورة مرتفع جداً، مما يدل على مهارة الموظفين في البيع الإضافي").
3.  **فرص للتحسين:** اذكر نقطة ضعف واحدة واضحة يمكن تحسينها (مثال: "نسبة تحويل الزوار منخفضة، مما يعني أننا لا ننجح في تحويل كل زائر إلى مشترٍ").
4.  **خطة عمل مقترحة:** اقترح خطوتين عمليتين ومحددتين يمكن لمدير الفرع تطبيقها هذا الأسبوع لتحسين نقطة الضعف المذكورة.

استخدم تنسيق الماركداون (Markdown) لتنظيم إجابتك.
`;
            const result = await geminiFetch({ contents: [{ parts: [{ text: prompt }] }] });
            setAiAnalysis(result);
        } catch (error) {
            console.error("Store analysis failed:", error);
            setAiAnalysis("عذراً، حدث خطأ أثناء تحليل البيانات. يرجى المحاولة مرة أخرى.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="space-y-6">
            <button onClick={onBack} className="btn-secondary flex items-center gap-2">
                <ArrowLeftIcon /> Back to All Stores
            </button>
            <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-3xl font-bold text-zinc-800">{store.name}</h2>
                <p className="text-zinc-500">Monthly Target: {store.target.toLocaleString('en-US', { style: 'currency', currency: 'SAR' })}</p>
            </div>

            <MonthYearFilter dateFilter={dateFilter} setDateFilter={setDateFilter} allData={allMetrics} />

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-6">
                <KPICard title="Total Sales" value={storeData.totalSales} format={val => val.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} />
                <KPICard title="Visitors" value={storeData.totalVisitors} />
                <KPICard title="Transactions" value={storeData.totalTransactions} />
                <KPICard title="Avg. Transaction Value" value={storeData.atv} format={val => val.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} />
                <KPICard title="Visitor Rate" value={storeData.visitorRate} format={v => `${v.toFixed(1)}%`} />
                <KPICard title="Sales Per Visitor" value={storeData.salesPerVisitor} format={val => val.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200">
                    <h3 className="font-semibold text-lg text-zinc-700 mb-3">AI Performance Review</h3>
                    <button onClick={handleGenerateAnalysis} disabled={isAnalyzing} className="btn-primary flex items-center gap-2">
                        <SparklesIcon />
                        {isAnalyzing ? '...جاري التحليل' : 'تحليل الأداء بالذكاء الاصطناعي'}
                    </button>
                    {isAnalyzing && <div className="mt-4 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div></div>}
                    {aiAnalysis && (
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg border max-h-64 overflow-y-auto">
                            <div className="prose" dangerouslySetInnerHTML={{ __html: aiAnalysis.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }}></div>
                        </div>
                    )}
                </div>
                <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200">
                    <h3 className="font-semibold text-lg text-zinc-700 mb-3">Dynamic Daily Target (Current Month)</h3>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span>Sales This Month:</span>
                            <span className="font-semibold">{dynamicTargetData.salesMTD.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Remaining Target (100%):</span>
                            <span className="font-semibold">{dynamicTargetData.remainingTarget > 0 ? dynamicTargetData.remainingTarget.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }) : "Target Achieved!"}</span>
                        </div>
                        <div className="flex justify-between pb-2">
                            <span>Remaining Days:</span>
                            <span className="font-semibold">{dynamicTargetData.remainingDays}</span>
                        </div>
                        <hr />
                        <div className="flex justify-between items-center text-base pt-2">
                            <span className="font-bold text-gray-700">Required for 90%:</span>
                            <span className="font-bold text-gray-700 text-lg">
                                {dynamicTargetData.requiredDailyAverage90.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} / day
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-base">
                            <span className="font-bold text-orange-600">Required for 100%:</span>
                            <span className="font-bold text-orange-600 text-lg">
                                {dynamicTargetData.requiredDailyAverage.toLocaleString('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 })} / day
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
const CommissionsPage = ({ storeSummary, employeeSummary }) => {

    const getStoreCommissionRate = (achievement) => {
        if (achievement >= 100) return 0.02; // 2%
        if (achievement >= 90) return 0.01; // 1%
        if (achievement >= 80) return 0.005; // 0.5%
        return 0;
    };

    const commissionData = useMemo(() => {
        const data = {};
        
        Object.values(employeeSummary).flat().forEach(employee => {
            const store = storeSummary.find(s => s.name === employee.store);
            if (!store) return;
            
            if (!data[store.name]) {
                const storeAchievement = store.targetAchievement || 0;
                data[store.name] = {
                    name: store.name,
                    achievement: storeAchievement,
                    commissionRate: getStoreCommissionRate(storeAchievement) * 100, // as percentage
                    employees: []
                };
            }

            const employeeAchievement = (employee.target > 0) ? (employee.totalSales / employee.target) * 100 : 0;
            const finalCommissionRate = (data[store.name].commissionRate / 100) * (employeeAchievement / 100);
            const commissionAmount = employee.totalSales * finalCommissionRate;

            data[store.name].employees.push({
                ...employee,
                achievement: employeeAchievement,
                finalCommissionRate: finalCommissionRate * 100, // as percentage
                commissionAmount: commissionAmount
            });
        });
        return data;
    }, [storeSummary, employeeSummary]);

    return (
        <div className="space-y-6">
            {Object.keys(commissionData).sort().map(storeName => {
                const store = commissionData[storeName];
                return (
                    <div key={storeName} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <div className="mb-4">
                            <h3 className="text-xl font-semibold text-zinc-800">{storeName}</h3>
                            <p className="text-sm text-zinc-500">
                                Store Achievement: {store.achievement.toFixed(1)}% | Applicable Commission Rate: <strong>{store.commissionRate.toFixed(1)}%</strong>
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="th">Employee</th>
                                        <th className="th">Total Sales</th>
                                        <th className="th">Employee Achievement</th>
                                        <th className="th">Final Commission Rate</th>
                                        <th className="th">Commission Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {store.employees.map(employee => (
                                        <tr key={employee.id}>
                                            <td className="td font-medium">{employee.name}</td>
                                            <td className="td">{employee.totalSales.toLocaleString('en-US', { style: 'currency', currency: 'SAR' })}</td>
                                            <td className="td">{employee.achievement.toFixed(1)}%</td>
                                            <td className="td font-semibold text-blue-600">{employee.finalCommissionRate.toFixed(2)}%</td>
                                            <td className="td font-semibold text-green-600">{employee.commissionAmount.toLocaleString('en-US', { style: 'currency', currency: 'SAR' })}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
const SettingsPage = ({ onDeleteAllData, isProcessing, employeeSummary, storeSummary, allDuvetSales }) => {
    return (
        <div className="space-y-6">
            <DataExporter 
                employeeSummary={employeeSummary} 
                storeSummary={storeSummary} 
                allDuvetSales={allDuvetSales}
            />
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="text-xl font-semibold text-zinc-700 mb-4">إدارة البيانات</h3>
                <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                    <h4 className="font-bold text-red-800">منطقة الخطر</h4>
                    <p className="text-red-700 mt-1">
                        سيؤدي هذا الإجراء إلى حذف جميع البيانات في قاعدة البيانات بشكل دائم، بما في ذلك المبيعات والموظفين والمتاجر. لا يمكن التراجع عن هذا الإجراء.
                    </p>
                    <div className="mt-4">
                        <button
                            onClick={onDeleteAllData}
                            disabled={isProcessing}
                            className="btn-danger"
                        >
                            {isProcessing ? 'جاري الحذف...' : 'حذف جميع البيانات'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
const DataExporter = ({ employeeSummary, storeSummary, allDuvetSales }) => {
    
    const exportEmployeesData = () => {
        if (typeof XLSX === 'undefined') {
            alert("File library is still loading. Please try again in a moment.");
            return;
        }

        const allEmployees = Object.values(employeeSummary).flat();

        const dataToExport = allEmployees.map(employee => {
            const achievement = (employee.target > 0) ? (employee.totalSales / employee.target) * 100 : 0;
            
            const employeeDuvetSales = allDuvetSales.filter(sale => sale['SalesMan Name'] === employee.name);
            const totalDuvets = employeeDuvetSales.reduce((sum, sale) => sum + (sale['Sold Qty'] || 0), 0);
            const duvetAchievement = (employee.duvetTarget > 0) ? (totalDuvets / employee.duvetTarget) * 100 : 0;

            return {
                'Employee Name': employee.name,
                'Store': employee.store,
                'Total Sales (SAR)': employee.totalSales,
                'Sales Target (SAR)': employee.target,
                'Sales Achievement (%)': achievement.toFixed(2),
                'Duvets Sold (Units)': totalDuvets,
                'Duvet Target (Units)': employee.duvetTarget,
                'Duvet Achievement (%)': duvetAchievement.toFixed(2),
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Employees Report");
        XLSX.writeFile(workbook, "Employees_Report.xlsx");
    };

    const exportStoresData = () => {
        if (typeof XLSX === 'undefined') {
            alert("File library is still loading. Please try again in a moment.");
            return;
        }

        const dataToExport = storeSummary.map(store => {
            const storeDuvetSales = allDuvetSales.filter(sale => sale['Outlet Name'] === store.name);
            const totalDuvets = storeDuvetSales.reduce((sum, sale) => sum + (sale['Sold Qty'] || 0), 0);

            return {
                'Store Name': store.name,
                'Total Sales (SAR)': store.totalSales,
                'Sales Target (SAR)': store.target,
                'Sales Achievement (%)': store.targetAchievement.toFixed(2),
                'Visitors': store.visitors,
                'Transactions': store.transactionCount,
                'Avg. Transaction Value (SAR)': store.atv.toFixed(2),
                'Visitor Rate (%)': store.visitorRate.toFixed(2),
                'Duvets Sold (Units)': totalDuvets,
            };
        });
        
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Stores Report");
        XLSX.writeFile(workbook, "Stores_Report.xlsx");
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xl font-semibold text-zinc-700 mb-4">Data Export</h3>
            <div className="flex flex-col sm:flex-row gap-4">
                <button onClick={exportEmployeesData} className="btn-primary flex-1">
                    Export Employees Report
                </button>
                <button onClick={exportStoresData} className="btn-primary flex-1">
                    Export Stores Report
                </button>
            </div>
        </div>
    );
};
const AiAnalysisPage = ({ geminiFetch, kpiData, storeSummary, employeeSummary, allProducts, salesTransactions, kingDuvetSales }) => {
    const [chatHistory, setChatHistory] = useState([
        {
            role: 'model',
            parts: [{ text: "أهلاً بك! أنا المستشار الذكي. بصفتي خبيراً في تحليل بيانات البيع بالتجزئة وتدريب الموظفين بخبرة تفوق 10 سنوات، أنا هنا لمساعدتك على فهم أعمق لأداء عملك. يمكنك أن تسألني عن أي شيء، على سبيل المثال:\n\n* 'ما هو تقييمك للأداء العام هذا الشهر؟'\n* 'من هو أفضل موظف مبيعاً وما سبب نجاحه؟'\n* 'ما هو المنتج الذي يجب أن نركز عليه لزيادة المبيعات؟'" }]
        }
    ]);
    const [userInput, setUserInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const chatEndRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!userInput.trim() || isThinking) return;

        const newHumanMessage = { role: 'user', parts: [{ text: userInput }] };
        
        setChatHistory(prev => [...prev, newHumanMessage]);
        setUserInput('');
        setIsThinking(true);
        
        try {
            const dataContext = `
--- OVERALL BUSINESS SNAPSHOT ---
- **Overall KPIs**: ${JSON.stringify(kpiData, null, 2)}
- **Full Store Summary**: ${JSON.stringify(storeSummary, null, 2)}
- **Full Employee Summary**: ${JSON.stringify(employeeSummary, null, 2)}
- **Recent Sales Transactions (Sample)**: ${JSON.stringify(salesTransactions.slice(-100), null, 2)}
- **Recent Duvet Sales Transactions (Sample)**: ${JSON.stringify(kingDuvetSales.slice(-100), null, 2)}
--- END OF DATA SNAPSHOT ---
`;

            const conversation = [...chatHistory, newHumanMessage].map(msg => ({
                role: msg.role,
                parts: msg.parts
            }));

            const systemPrompt = {
                parts: [{
                    text: `أنت "المستشار الذكي"، خبير في مجال تحليل بيانات البيع بالتجزئة، مدرب موظفين، وخبير إداري بخبرة تزيد عن 10 سنوات. مهمتك هي تحليل البيانات الشاملة المقدمة لك وتقديم رؤى عميقة وقابلة للتنفيذ. أنت تتطور وتتعلم من سياق المحادثة بالكامل.

**البيانات المتاحة لك في كل سؤال:**
1.  **KPIs شاملة:** مؤشرات الأداء الرئيسية للعمل ككل.
2.  **ملخص كامل للمعارض:** بيانات أداء كل معرض على حدة.
3.  **ملخص كامل للموظفين:** بيانات أداء كل موظف على حدة.
4.  **عينة من آخر 100 عملية بيع:** تفاصيل دقيقة لكل عملية بيع بما في ذلك اسم المنتج، السعر، والكمية.

**قواعدك الأساسية:**
1.  **اللغة:** يجب أن تكون جميع إجاباتك باللغة العربية الفصحى والواضحة.
2.  **التحليل العميق والمترابط:** لا تكتفِ بسرد الأرقام. اربط البيانات ببعضها البعض. عند سؤالك عن موظف، حلل أداءه من ملخص الموظفين ثم تعمق في عينة المبيعات لترى **ماذا يبيع بالضبط**. هل يركز على منتجات رخيصة أم غالية؟ هل يبيع منتجات مرتبطة ببعضها (بيع متقاطع)؟
3.  **التحليل الشامل للمعارض:** عند سؤالك عن معرض، حلل أداءه العام (KPIs) ثم انظر إلى أداء الموظفين داخل هذا المعرض ومنتجاتهم الأكثر مبيعاً لفهم أسباب النجاح أو الضعف.
4.  **اقتراحات عملية ومخصصة:** قدم دائماً نصائح واقتراحات محددة وقابلة للتطبيق. بدلاً من قول "يجب تحسين المبيعات"، قل "لاحظت أن الموظف (س) يركز على بيع المنتجات منخفضة السعر. أقترح تدريبه على عرض المنتج (ص) الأعلى سعراً كبديل للعملاء لرفع متوسط قيمة الفاتورة".
5.  **التعلم من المحادثة:** استخدم سياق الأسئلة والأجوبة السابقة لفهم نية المستخدم بشكل أفضل وتقديم إجابات أكثر دقة وتطوراً في كل مرة.
6.  **الالتزام بالبيانات:** يجب أن تستند جميع تحليلاتك واقتراحاتك بشكل صارم وحصري على "DATA SNAPSHOT" المقدمة لك في كل مرة. لا تخترع أي معلومات غير موجودة.
7.  **تنسيق الإجابة:** استخدم تنسيق الماركداون (Markdown) بفعالية (عناوين، نقاط، نص عريض) لتنظيم إجابتك وجعلها سهلة القراءة.
`
                }]
            };
            
            const apiPayload = {
                contents: [...conversation, { role: 'user', parts: [{ text: `${dataContext}\n\nUser Question: ${userInput}` }] }],
                systemInstruction: systemPrompt,
            };
            
            const responseText = await geminiFetch(apiPayload);
            const newModelMessage = { role: 'model', parts: [{ text: responseText }] };
            setChatHistory(prev => [...prev, newModelMessage]);

        } catch (error) {
            console.error("AI Analysis Error:", error);
            const errorMessage = { role: 'model', parts: [{ text: "عذراً، لقد واجهت خطأ أثناء تحليل البيانات. يرجى المحاولة مرة أخرى." }] };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="h-[calc(100vh-12rem)] flex flex-col bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="flex-grow p-6 overflow-y-auto">
                <div className="space-y-4">
                    {chatHistory.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`p-3 rounded-lg max-w-lg ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-zinc-800'}`}>
                                <div className="prose" dangerouslySetInnerHTML={{ __html: msg.parts[0].text.replace(/\n/g, '<br />').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>') }}></div>
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex justify-start">
                            <div className="p-3 rounded-lg bg-gray-200 text-zinc-800">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse delay-75"></div>
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse delay-150"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            </div>
            <div className="p-4 border-t border-gray-200">
                <form onSubmit={handleSubmit} className="flex gap-4">
                    <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="اطرح سؤالك هنا..."
                        className="input flex-grow"
                        disabled={isThinking}
                    />
                    <button type="submit" className="btn-primary" disabled={isThinking || !userInput.trim()}>إرسال</button>
                </form>
            </div>
        </div>
    );
};
const downloadTemplate = (fileName, headers) => {
    if (typeof XLSX === 'undefined') {
        alert("File library is still loading. Please try again in a moment.");
        return;
    }
    const worksheet = XLSX.utils.json_to_sheet([], { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
};


// --- Custom Hook for Smart Uploader ---
const useSmartUploader = (db, setAppMessage, setIsProcessing, geminiFetchWithRetry) => {
    const [uploadResult, setUploadResult] = useState(null);

    const clearUploadResult = () => setUploadResult(null);

    const findValueByKeyVariations = (row, keys) => {
        for (const key of keys) {
            if (!key) continue;
            const lowerKey = key.toLowerCase().trim();
            for (const rowKey in row) {
                if (rowKey.toLowerCase().trim() === lowerKey) {
                    const value = row[rowKey];
                    if (value !== undefined && value !== null) return value;
                }
            }
        }
        return undefined;
    };
    
    const parseDate = (dateInput) => {
        if (!dateInput) return null;
        // The normalizeDate function is the most reliable way to handle various formats.
        // We'll use it to get a consistent 'YYYY-MM-DD' string.
        const normalized = normalizeDate(dateInput);
        if (normalized) {
            // Then, create a Date object in UTC to avoid timezone shifts.
            const parts = normalized.split('-').map(Number);
            return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        }
        return null;
    };


    const parseNumber = (numInput) => {
        if (numInput === undefined || numInput === null) return 0;
        const cleaned = Number(String(numInput).replace(/,/g, ''));
        return isNaN(cleaned) ? 0 : cleaned;
    };


    const handleSmartUpload = async (parsedData, allStores, allEmployees, setProgress) => {
        if (!db) { setAppMessage({ isOpen: true, text: 'Database not connected.', type: 'alert' }); return; }
        if (!parsedData || parsedData.length === 0) { setAppMessage({ isOpen: true, text: 'File is empty or could not be read.', type: 'alert' }); return; }
        
        setIsProcessing(true);
        setProgress(0);
        setUploadResult(null);
        setAppMessage({ isOpen: true, text: 'AI is analyzing your file structure...', type: 'alert' });

        let fileType, headerMap, format;

        try {
            const headers = Object.keys(parsedData[0]).join(', ');
            const sampleRows = parsedData.slice(0, 3).map(row => Object.values(row).join(', ')).join('\n');
            const preview = `Headers: ${headers}\nSample rows:\n${sampleRows}`;

            const prompt = `
You are an expert data import specialist for a retail company. Analyze the provided file preview. Your task is to identify the file type, its format, and map its columns to our system's required columns.

The possible file types are: 'employee_sales', 'item_wise_sales', 'install', 'visitors'.

Our system's required columns for each type are:
- 'employee_sales': ['Sales Man Name', 'Outlet Name', 'Bill Date', 'Net Amount', 'Total Sales Bills']
- 'item_wise_sales': ['Outlet Name', 'SalesMan Name', 'Bill Dt.', 'Item Name', 'Item Alias', 'Sold Qty', 'Item Rate']
- 'install': ['Type', 'Store Name', 'Store Target', 'Employee Name', 'Employee Store', 'Employee Sales Target', 'Employee Duvet Target']
- 'visitors': ['Date', 'Store Name', 'Visitors']

**Analysis Rules:**
1.  **'employee_sales' File Structure:** This type can have two formats. You MUST identify which one it is.
    - **'grouped'**: The salesman's name is on its own row, and their sales data follows on subsequent rows which do NOT contain the name.
    - **'flat'**: All data, including the salesman's name, outlet, date, and sales, exists on a single row.
2.  **'install' File Variations:** An 'install' file can contain stores, employees, or both. A file containing columns like 'Outlet Name', 'Sales Man Name', and a target column (e.g., 'sep Target') should be identified as an 'install' file. Map 'Outlet Name' to 'Employee Store' and the target column to 'Employee Sales Target'.
3.  **Flexible Column Names:** The headers might be different. Match them intelligently. 'Net Amount' could be 'Net Sales'; 'sep Target' is 'Employee Sales Target'.
4.  **Date Formats:** Dates can be Excel serial numbers (e.g., 45916), 'YYYY-MM-DD', 'DD/MM/YYYY', or 'DD-MM-YYYY'.

Based on the preview, return ONLY a valid JSON object with "fileType", "headerMap", and a "format" key. The "format" key should be 'grouped' or 'flat' if the fileType is 'employee_sales', otherwise it should be null.

Example Response for a flat sales file: {"fileType": "employee_sales", "format": "flat", "headerMap": {"Sales Man Name": "Sales Man Name", "Outlet Name": "Outlet Name", "Bill Date": "Bill Date", "Net Amount": "Net Amount", "Total Sales Bills": "Total Sales Bills"}}
Example Response for a grouped sales file: {"fileType": "employee_sales", "format": "grouped", "headerMap": {"Sales Man Name": "Sales Man Name", "Outlet Name": "Outlet Name", "Bill Date": "Bill Date", "Net Amount": "Net Amount", "Total Sales Bills": "Total Sales Bills"}}
 
File Preview:
${preview}
`;
            
            const response = await geminiFetchWithRetry({ contents: [{ parts: [{ text: prompt }] }] });
            const cleanedResponse = response.match(/\{.*\}/s)[0];
            const analysis = JSON.parse(cleanedResponse);
            fileType = analysis.fileType;
            headerMap = analysis.headerMap;
            format = analysis.format;

            if (fileType === 'unrecognized' || !fileType) {
                setAppMessage({ isOpen: true, text: 'AI could not recognize the file format. Please use one of the templates.', type: 'alert' });
                setIsProcessing(false);
                return;
            }
            setAppMessage(prev => ({ ...prev, isOpen: false }));
            setAppMessage({ isOpen: true, text: `AI identified file as: ${fileType} (${format || 'default'}). Starting upload...`, type: 'alert' });

        } catch (error) {
            console.error("AI Analysis failed:", error);
            setAppMessage({ isOpen: true, text: `AI analysis failed: ${error.message}. Please try again or use a template.`, type: 'alert' });
            setIsProcessing(false);
            return;
        }

        const CHUNK_SIZE = 400;
        let successfulRecords = [];
        let skippedCount = 0;

        for (let i = 0; i < parsedData.length; i += CHUNK_SIZE) {
            const chunk = parsedData.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            let chunkSuccessfulRecords = [];
            let chunkSkippedCount = 0;
            
            switch (fileType) {
                case 'employee_sales': {
                    let currentSalesmanName = null;
                    for (const row of chunk) {
                        if (format === 'flat') {
                            const salesmanName = findValueByKeyVariations(row, [headerMap['Sales Man Name']]);
                            const outletName = findValueByKeyVariations(row, [headerMap['Outlet Name']]);
                            const netAmountInput = findValueByKeyVariations(row, [headerMap['Net Amount']]);
                            const totalSalesBillsInput = findValueByKeyVariations(row, [headerMap['Total Sales Bills']]);
                            const billDateInput = findValueByKeyVariations(row, [headerMap['Bill Date']]);
                            
                            if (salesmanName && outletName && netAmountInput !== undefined && totalSalesBillsInput !== undefined && billDateInput) {
                                const jsDate = parseDate(billDateInput);
                                if (jsDate) {
                                    const netAmount = parseNumber(netAmountInput);
                                    const totalSalesBills = parseNumber(totalSalesBillsInput);
                                    const formattedDate = jsDate.toISOString().split('T')[0];
                                    const preparedData = { date: formattedDate, store: String(outletName).trim(), employee: String(salesmanName).trim(), totalSales: netAmount, transactionCount: totalSalesBills };
                                    batch.set(doc(collection(db, 'dailyMetrics')), preparedData);
                                    chunkSuccessfulRecords.push({ dataType: 'Employee Daily Sales', name: salesmanName, value: `Sales: ${netAmount.toLocaleString()}` });
                                } else { chunkSkippedCount++; }
                            } else { chunkSkippedCount++; }
                        } else { // grouped format
                            const salesmanName = findValueByKeyVariations(row, [headerMap['Sales Man Name']]);
                            const outletName = findValueByKeyVariations(row, [headerMap['Outlet Name']]);

                            if (salesmanName && String(salesmanName).trim() && !String(salesmanName).toLowerCase().includes('total')) {
                                currentSalesmanName = String(salesmanName).trim();
                                continue;
                            }
                            if (!salesmanName && outletName && currentSalesmanName) {
                                const netAmountInput = findValueByKeyVariations(row, [headerMap['Net Amount']]);
                                const totalSalesBillsInput = findValueByKeyVariations(row, [headerMap['Total Sales Bills']]);
                                const billDateInput = findValueByKeyVariations(row, [headerMap['Bill Date']]);
                                
                                if (netAmountInput !== undefined && totalSalesBillsInput !== undefined && billDateInput) {
                                    const jsDate = parseDate(billDateInput);
                                    if (jsDate) {
                                        const netAmount = parseNumber(netAmountInput);
                                        const totalSalesBills = parseNumber(totalSalesBillsInput);
                                        const formattedDate = jsDate.toISOString().split('T')[0];
                                        const preparedData = { date: formattedDate, store: String(outletName).trim(), employee: currentSalesmanName, totalSales: netAmount, transactionCount: totalSalesBills };
                                        batch.set(doc(collection(db, 'dailyMetrics')), preparedData);
                                        chunkSuccessfulRecords.push({ dataType: 'Employee Daily Sales', name: currentSalesmanName, value: `Sales: ${netAmount.toLocaleString()}` });
                                        continue;
                                    }
                                }
                            }
                            chunkSkippedCount++;
                        }
                    }
                    break;
                }
                case 'item_wise_sales': {
                    for (const row of chunk) {
                        const outletName = findValueByKeyVariations(row, [headerMap['Outlet Name']]);
                        const salesManNameTrans = findValueByKeyVariations(row, [headerMap['SalesMan Name']]);
                        const itemName = findValueByKeyVariations(row, [headerMap['Item Name']]);
                        const billDtInput = findValueByKeyVariations(row, [headerMap['Bill Dt.']]);
                        const itemAlias = findValueByKeyVariations(row, [headerMap['Item Alias']]);

                        if (outletName && salesManNameTrans && itemName && billDtInput && itemAlias) {
                            const jsDate = parseDate(billDtInput);
                            if (jsDate) {
                                const formattedDate = jsDate.toISOString().split('T')[0];
                                const soldQty = parseNumber(findValueByKeyVariations(row, [headerMap['Sold Qty']]) || 1);
                                const itemRate = parseNumber(findValueByKeyVariations(row, [headerMap['Item Rate']]) || 0);
                                const data = { 'Outlet Name': outletName, 'Bill Dt.': formattedDate, 'Item Name': itemName, 'Item Alias': itemAlias, 'Sold Qty': soldQty, 'Item Rate': itemRate, 'SalesMan Name': salesManNameTrans, 'Item Net Amt': soldQty * itemRate };
                                const collectionName = String(itemAlias).startsWith('4') ? 'kingDuvetSales' : 'salesTransactions';
                                batch.set(doc(collection(db, collectionName)), data);
                                chunkSuccessfulRecords.push({ dataType: 'Product Sale', name: itemName, value: `Qty: ${soldQty}` });
                                continue;
                            }
                        }
                        chunkSkippedCount++;
                    }
                    break;
                }
                case 'install': {
                    for (const row of chunk) {
                        const type = findValueByKeyVariations(row, [headerMap['Type']])?.toLowerCase();
                        
                        const employeeName = findValueByKeyVariations(row, [headerMap['Employee Name']]);
                        const employeeStore = findValueByKeyVariations(row, [headerMap['Employee Store']]);
                        const salesTargetInput = findValueByKeyVariations(row, [headerMap['Employee Sales Target']]);
                        
                        if (type === 'employee' || (employeeName && employeeStore && salesTargetInput !== undefined)) {
                            const salesTarget = parseNumber(salesTargetInput);
                            const duvetTargetInput = findValueByKeyVariations(row, [headerMap['Employee Duvet Target']]);
                            const duvetTarget = parseNumber(duvetTargetInput);
                            
                            batch.set(doc(collection(db, 'employees')), { name: String(employeeName).trim(), store: String(employeeStore).trim(), target: salesTarget, duvetTarget: duvetTarget }, { merge: true });
                            chunkSuccessfulRecords.push({ dataType: 'Employee Install', name: employeeName, value: `Sales Target: ${salesTarget.toLocaleString()}` });

                        }
                        else if (type === 'store') {
                            const storeName = findValueByKeyVariations(row, [headerMap['Store Name']]);
                            const targetInput = findValueByKeyVariations(row, [headerMap['Store Target']]);
                            if (storeName && targetInput !== undefined) {
                                const target = parseNumber(targetInput);
                                batch.set(doc(collection(db, 'stores')), { name: String(storeName).trim(), target: target }, { merge: true });
                                chunkSuccessfulRecords.push({ dataType: 'Store Install', name: storeName, value: `Target: ${target.toLocaleString()}` });
                            } else { chunkSkippedCount++; }
                        }
                        else { chunkSkippedCount++; }
                    }
                    break;
                }
                case 'visitors': {
                    for (const row of chunk) {
                        const storeName = findValueByKeyVariations(row, [headerMap['Store Name']]);
                        const dateInput = findValueByKeyVariations(row, [headerMap['Date']]);
                        const visitorsInput = findValueByKeyVariations(row, [headerMap['Visitors']]);
                        
                        if (storeName && dateInput && visitorsInput !== undefined) {
                            const jsDate = parseDate(dateInput);
                            if (jsDate) {
                                const visitors = parseNumber(visitorsInput);
                                const formattedDate = jsDate.toISOString().split('T')[0];
                                const data = { date: formattedDate, store: storeName, visitors: visitors };
                                batch.set(doc(collection(db, 'dailyMetrics')), data, { merge: true });
                                chunkSuccessfulRecords.push({ dataType: 'Daily Visitors', name: storeName, value: `${visitors} visitors on ${formattedDate}` });
                                continue;
                            }
                        }
                        chunkSkippedCount++;
                    }
                    break;
                }
                default:
                    setAppMessage({ isOpen: true, text: 'File format not recognized by the system.', type: 'alert' });
                    setIsProcessing(false);
                    setProgress(0);
                    return;
            }

            try {
                await batch.commit();
                successfulRecords = successfulRecords.concat(chunkSuccessfulRecords);
                skippedCount += chunkSkippedCount;
                const currentProgress = ((i + chunk.length) / parsedData.length) * 100;
                setProgress(currentProgress);
            } catch (error) {
                setAppMessage({ isOpen: true, text: `Upload failed during save: ${error.message}`, type: 'alert' });
                setIsProcessing(false);
                setProgress(0);
                return;
            }
        }

        setUploadResult({ successful: successfulRecords, skipped: skippedCount });
        setAppMessage({ isOpen: true, text: `Upload complete! Processed ${successfulRecords.length} records.`, type: 'alert' });
        setIsProcessing(false);
    };

    return { handleSmartUpload, uploadResult, clearUploadResult };
};
const SmartUploader = ({ onUpload, isProcessing, geminiFetchWithRetry, uploadResult, onClearResult }) => {
    const [file, setFile] = useState(null);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setAiAnalysis(null);
        onClearResult();
        setUploadProgress(0);
    };

    const handleAnalyze = async () => {
        if (!file) return;
        setIsAnalyzing(true);
        setAiAnalysis(null);
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    if (typeof XLSX === 'undefined') {
                        throw new Error("File processing library is not loaded yet. Please wait a moment and try again.");
                    }
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const preview = XLSX.utils.sheet_to_csv(worksheet).substring(0, 2000);
                    const systemPrompt = `You are a data classification expert. Analyze the columns. Your response MUST be ONLY a valid JSON object.
Example: {"summary": "This file contains a mix of product data and sales transactions."}`;
                    
                    const cleaned = await geminiFetchWithRetry({ contents: [{ parts: [{ text: `Analyze this data:\n${preview}\n\n${systemPrompt}` }] }] });
                    
                    const match = cleaned.match(/\{.*\}/s);
                    if (match) {
                        setAiAnalysis(JSON.parse(match[0]));
                    } else {
                        throw new Error("No valid JSON object found in AI response.");
                    }
                } catch (error) {
                    console.error("Error analyzing file:", error);
                    setAiAnalysis({ error: `Failed to analyze file: ${error.message}` });
                } finally {
                    setIsAnalyzing(false);
                }
            };
            reader.onerror = (error) => {
                console.error("File Reader Error:", error);
                setAiAnalysis({ error: "Failed to read file." });
                setIsAnalyzing(false);
            };
            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error("Error setting up analysis:", error);
            setAiAnalysis({ error: `An setup error occurred: ${error.message}` });
            setIsAnalyzing(false);
        }
    };

    const handleUpload = () => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });
                onUpload(jsonData, setUploadProgress);
            } catch (error) {
                console.error("Error processing file for upload:", error);
                setAiAnalysis({ error: `File processing failed: ${error.message}` });
            }
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-zinc-700">Smart Data Uploader</h3>
                <p className="text-sm text-zinc-500 mt-1">Upload an XLSX file. The system will automatically detect the file type and import the data correctly.</p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg border">
                <h4 className="font-semibold text-zinc-600 mb-2">Download Templates</h4>
                <p className="text-xs text-zinc-500 mb-3">Use these templates to ensure your data is in the correct format for uploading.</p>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadTemplate('Sales_Summary_Template', ['Sales Man Name', 'Outlet Name', 'Bill Date', 'Net Amount', 'Total Sales Bills'])} className="btn-secondary text-sm">Sales Summary</button>
                    <button onClick={() => downloadTemplate('Item_Wise_Sales_Template', ['Outlet Name', 'SalesMan Name', 'Bill Dt.', 'Item Name', 'Item Alias', 'Sold Qty', 'Item Rate'])} className="btn-secondary text-sm">Item-wise Sales</button>
                    <button onClick={() => downloadTemplate('Install_Template', ['Type', 'Store Name', 'Store Target', 'Employee Name', 'Employee Store', 'Employee Sales Target', 'Employee Duvet Target'])} className="btn-secondary text-sm">Install File (Stores & Employees)</button>
                    <button onClick={() => downloadTemplate('Visitors_Template', ['Date', 'Store Name', 'Visitors'])} className="btn-secondary text-sm">Visitors</button>
                </div>
            </div>

            <div>
                <label className="label font-semibold">Upload Your File</label>
                <input type="file" onChange={handleFileChange} accept=".xlsx, .xls" className="file-input mt-2" />
            </div>

            {file && (
                <div className="flex gap-4">
                    <button onClick={handleAnalyze} disabled={isAnalyzing || isProcessing} className="btn-secondary flex-1">
                        {isAnalyzing ? 'Analyzing...' : 'Analyze File Content'}
                    </button>
                    <button onClick={handleUpload} disabled={isProcessing || isAnalyzing || !file} className="btn-primary flex-1">
                        {isProcessing ? 'Uploading...' : 'Upload Data'}
                    </button>
                </div>
            )}

            {isProcessing && (
                <div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
                        <div className="bg-orange-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%`, transition: 'width 0.5s' }}></div>
                    </div>
                    <p className="text-center text-sm text-zinc-600 mt-1">{Math.round(uploadProgress)}% Complete</p>
                </div>
            )}

            {isAnalyzing && !isProcessing && (
                <div className="text-center p-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600 mx-auto"></div>
                    <p className="mt-2 text-zinc-600">AI is analyzing your file...</p>
                </div>
            )}
            
            {aiAnalysis && (
                <div className={`p-4 rounded-lg ${aiAnalysis.error ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    <h4 className="font-bold">AI Analysis Result:</h4>
                    <p>{aiAnalysis.summary || aiAnalysis.error}</p>
                </div>
            )}

            {uploadResult && (
                <div className="p-4 rounded-lg bg-green-100 text-green-700">
                    <h4 className="font-bold">Upload Complete</h4>
                    <p>Successfully processed {uploadResult.successful.length} records.</p>
                    {uploadResult.skipped > 0 && <p>{uploadResult.skipped} rows were skipped due to invalid data.</p>}
                    <div className="mt-2 h-40 overflow-y-auto border border-green-200 rounded p-2 text-xs bg-white">
                        <h5 className="font-semibold mb-1">Processed Data Preview:</h5>
                        <ul>
                            {uploadResult.successful.slice(0, 10).map((item, i) => <li key={i}>{item.dataType}: {item.name} - {item.value}</li>)}
                        </ul>
                    </div>
                    <button onClick={onClearResult} className="btn-secondary mt-2">Clear</button>
                </div>
            )}
        </div>
    );
};


// --- Main App Component ---
const App = () => {
    // ... State definitions ...
    const [db, setDb] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [dailyMetrics, setDailyMetrics] = useState([]);
    const [kingDuvetSales, setKingDuvetSales] = useState([]);
    const [salesTransactions, setSalesTransactions] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [allStores, setAllStores] = useState([]);
    const [employeeSummary, setEmployeeSummary] = useState({});
    const [storeSummary, setStoreSummary] = useState([]);
    const [filteredData, setFilteredData] = useState({ dailyMetrics: [], kingDuvetSales: [], salesTransactions: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState("Initializing...");
    const [activeTab, setActiveTab] = useState('dashboard');
    const [lflStoreFilter, setLflStoreFilter] = useState('All');
    const [lflMonthFilter, setLflMonthFilter] = useState(new Date().getMonth());
    const [selectedEmployeeForDuvets, setSelectedEmployeeForDuvets] = useState(null);
    const [selectedStore, setSelectedStore] = useState(null);
    const [dateFilter, setDateFilter] = useState({ year: new Date().getFullYear(), month: 'all', day: 'all' });
    const [modalState, setModalState] = useState({ type: null, data: null });
    const [appMessage, setAppMessage] = useState({ isOpen: false, text: '', type: 'alert', onConfirm: null });
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    
    // ... useEffect hooks and other logic ...
    useEffect(() => {
        const scriptId = 'xlsx-script';
        if (!document.getElementById(scriptId)) {
            const script = document.createElement('script');
            script.id = scriptId;
            script.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
            script.async = true;
            document.body.appendChild(script);
        }
    }, []);

    useEffect(() => {
        setLoadingMessage("Initializing Firebase services...");
        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        setDb(getFirestore(app));
    
        const authUnsubscribe = onAuthStateChanged(authInstance, user => {
            if (user) {
                setIsAuthReady(true);
            }
        });
    
        setLoadingMessage("Authenticating with server...");
        signInAnonymously(authInstance).catch(err => {
            console.error("Anonymous sign-in failed:", err);
            setLoadingMessage(`Authentication failed: ${err.message}`);
        });
    
        return () => authUnsubscribe();
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db) {
            return;
        }

        setLoadingMessage("Loading business data...");

        const collectionsToWatch = {
            dailyMetrics: setDailyMetrics,
            kingDuvetSales: setKingDuvetSales,
            salesTransactions: setSalesTransactions,
            employees: setAllEmployees,
            stores: setAllStores,
        };

        const numCollections = Object.keys(collectionsToWatch).length;
        const loadedCollections = new Set();

        const unsubscribers = Object.entries(collectionsToWatch).map(([name, setter]) =>
            onSnapshot(collection(db, name),
                (snapshot) => {
                    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setter(data);

                    if (!loadedCollections.has(name)) {
                        loadedCollections.add(name);
                        if (loadedCollections.size === numCollections) {
                            setIsLoading(false);
                        }
                    }
                },
                (err) => {
                    console.error(`Error fetching ${name}:`, err);
                    setAppMessage({ isOpen: true, text: `Failed to load data for ${name}.`, type: 'alert' });
                    
                    if (!loadedCollections.has(name)) {
                        loadedCollections.add(name);
                        if (loadedCollections.size === numCollections) {
                            setIsLoading(false);
                        }
                    }
                }
            )
        );
        
        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }, [isAuthReady, db]);

    useEffect(() => {
        if (isSidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isSidebarOpen]);
    
    const allProducts = useMemo(() => {
        const combinedSales = [...filteredData.salesTransactions, ...filteredData.kingDuvetSales];
        const productsMap = new Map();

        combinedSales.forEach(sale => {
            const alias = sale['Item Alias'];
            const soldQty = Number(sale['Sold Qty'] || 0);

            if (alias) {
                if (productsMap.has(alias)) {
                    const existingProduct = productsMap.get(alias);
                    existingProduct.soldQty += soldQty;
                } else {
                    productsMap.set(alias, {
                        id: alias,
                        name: sale['Item Name'],
                        alias: alias,
                        price: sale['Item Rate'],
                        soldQty: soldQty
                    });
                }
            }
        });

        return Array.from(productsMap.values()).sort((a, b) => b.soldQty - a.soldQty);
    }, [filteredData.salesTransactions, filteredData.kingDuvetSales]);


    useEffect(() => {
        const filterByDate = (item) => {
            const itemDateStr = item.date || item['Bill Dt.'];
            if (!itemDateStr) return false;
            
            const parts = String(itemDateStr).split('-'); // YYYY-MM-DD
            if (parts.length !== 3) return false;
            const itemDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));

            const yearMatch = dateFilter.year === 'all' || itemDate.getUTCFullYear() === dateFilter.year;
            const monthMatch = dateFilter.month === 'all' || itemDate.getUTCMonth() === dateFilter.month;
            const dayMatch = dateFilter.day === 'all' || itemDate.getUTCDate() === dateFilter.day;

            return yearMatch && monthMatch && dayMatch;
        };

        setFilteredData({
            dailyMetrics: dailyMetrics.filter(filterByDate),
            kingDuvetSales: kingDuvetSales.filter(filterByDate),
            salesTransactions: salesTransactions.filter(filterByDate)
        });
    }, [dateFilter, dailyMetrics, kingDuvetSales, salesTransactions]);
    
    const processAllData = useCallback(() => {
        const { dailyMetrics: currentMetrics } = filteredData;
        
        const metricsByEmployee = new Map();
        currentMetrics.forEach(metric => {
            if (metric.employee) {
                const existing = metricsByEmployee.get(metric.employee) || { totalSales: 0, totalTransactions: 0 };
                existing.totalSales += Number(metric.totalSales || 0);
                existing.totalTransactions += Number(metric.transactionCount || 0);
                metricsByEmployee.set(metric.employee, existing);
            }
        });

        const newEmpSummary = {};
        allEmployees.forEach(employee => {
            const { name, store } = employee;
            if (!name || !store) return;

            if (!newEmpSummary[store]) {
                newEmpSummary[store] = {};
            }

            const salesData = metricsByEmployee.get(name) || { totalSales: 0, totalTransactions: 0 };

            newEmpSummary[store][name] = {
                ...employee,
                totalSales: salesData.totalSales,
                totalTransactions: salesData.totalTransactions,
            };
        });
        
        const finalEmpSummary = {};
        for (const storeName in newEmpSummary) {
            finalEmpSummary[storeName] = Object.values(newEmpSummary[storeName]);
        }
        setEmployeeSummary(finalEmpSummary);

        const storeSum = allStores.reduce((acc, store) => {
            const metricsForStore = currentMetrics.filter(m => m.store === store.name);
            const totalSales = metricsForStore.reduce((sum, m) => sum + Number(m.totalSales || 0), 0);
            const visitors = metricsForStore.reduce((sum, m) => sum + Number(m.visitors || 0), 0);
            const transactionCount = metricsForStore.reduce((sum, m) => sum + Number(m.transactionCount || 0), 0);
            
            acc[store.name] = {
                ...store,
                totalSales,
                transactionCount,
                visitors,
                atv: transactionCount > 0 ? totalSales / transactionCount : 0,
                visitorRate: visitors > 0 ? (transactionCount / visitors) * 100 : 0,
                targetAchievement: store.target > 0 ? (totalSales / store.target) * 100 : 0,
                salesPerVisitor: visitors > 0 ? totalSales / visitors : 0
            };
            return acc;
        }, {});
        
        setStoreSummary(Object.values(storeSum).sort((a, b) => b.totalSales - a.totalSales));

    }, [filteredData, allEmployees, allStores]);


    useEffect(() => { processAllData(); }, [processAllData]);

    const allDuvetSalesForExport = useMemo(() => {
        return kingDuvetSales;
    }, [kingDuvetSales]);

    const employeeSummaryForExport = useMemo(() => {
        const allMetricsForCalculation = dailyMetrics;
        const metricsByEmployee = new Map();
        allMetricsForCalculation.forEach(metric => {
            if (metric.employee) {
                const existing = metricsByEmployee.get(metric.employee) || { totalSales: 0, totalTransactions: 0 };
                existing.totalSales += Number(metric.totalSales || 0);
                existing.totalTransactions += Number(metric.transactionCount || 0);
                metricsByEmployee.set(metric.employee, existing);
            }
        });
        const summary = {};
        allEmployees.forEach(employee => {
            const { name, store } = employee;
            if (!name || !store) return;
            if (!summary[store]) {
                summary[store] = {};
            }
            const salesData = metricsByEmployee.get(name) || { totalSales: 0, totalTransactions: 0 };
            summary[store][name] = {
                ...employee,
                totalSales: salesData.totalSales,
                totalTransactions: salesData.totalTransactions,
            };
        });
         const finalSummary = {};
        for (const storeName in summary) {
            finalSummary[storeName] = Object.values(summary[storeName]);
        }
        return finalSummary;
    }, [dailyMetrics, allEmployees]);

    const storeSummaryForExport = useMemo(() => {
        const allMetricsForCalculation = dailyMetrics;
        const storeSum = allStores.reduce((acc, store) => {
            const metricsForStore = allMetricsForCalculation.filter(m => m.store === store.name);
            const totalSales = metricsForStore.reduce((sum, m) => sum + Number(m.totalSales || 0), 0);
            const visitors = metricsForStore.reduce((sum, m) => sum + Number(m.visitors || 0), 0);
            const transactionCount = metricsForStore.reduce((sum, m) => sum + Number(m.transactionCount || 0), 0);
            
            acc[store.name] = {
                ...store,
                totalSales,
                transactionCount,
                visitors,
                atv: transactionCount > 0 ? totalSales / transactionCount : 0,
                visitorRate: visitors > 0 ? (transactionCount / visitors) * 100 : 0,
                targetAchievement: store.target > 0 ? (totalSales / store.target) * 100 : 0,
                salesPerVisitor: visitors > 0 ? totalSales / visitors : 0
            };
            return acc;
        }, {});
        return Object.values(storeSum);
    }, [dailyMetrics, allStores]);


    const lflData = useMemo(() => {
        const allData = dailyMetrics.map(s => ({ date: s.date, store: s.store, totalSales: s.totalSales, transactionCount: s.transactionCount, visitors: s.visitors || 0 }));

        const processPeriod = (data, startDate, endDate) => {
            const filtered = data.filter(s => {
                if (!s.date) return false;
                const d = new Date(`${s.date}T00:00:00Z`);
                return d >= startDate && d <= endDate;
            });
            const totalSales = filtered.reduce((sum, item) => sum + parseFloat(item.totalSales || 0), 0);
            const totalVisitors = filtered.reduce((sum, item) => sum + (parseInt(item.visitors, 10) || 0), 0);
            const totalTransactions = filtered.reduce((sum, item) => sum + (parseInt(item.transactionCount, 10) || 0), 0);
            return { totalSales, totalTransactions, atv: totalTransactions > 0 ? totalSales / totalTransactions : 0, totalVisitors, visitorRate: totalVisitors > 0 ? (totalTransactions / totalVisitors) * 100 : 0 };
        };

        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;

        // Start and end of the selected month for the current year
        const currentMonthStart = new Date(Date.UTC(currentYear, lflMonthFilter, 1));
        const currentMonthEnd = new Date(Date.UTC(currentYear, lflMonthFilter + 1, 0, 23, 59, 59, 999));

        // Start and end of the selected month for the previous year
        const previousMonthStart = new Date(Date.UTC(previousYear, lflMonthFilter, 1));
        const previousMonthEnd = new Date(Date.UTC(previousYear, lflMonthFilter + 1, 0, 23, 59, 59, 999));

        const dataForFilter = lflStoreFilter === 'All' ? allData : allData.filter(s => s.store === lflStoreFilter);

        return {
            current: processPeriod(dataForFilter, currentMonthStart, currentMonthEnd),
            previous: processPeriod(dataForFilter, previousMonthStart, previousMonthEnd)
        };
    }, [dailyMetrics, lflStoreFilter, lflMonthFilter]);

    const kpiData = useMemo(() => {
        if (storeSummary.length === 0) return { totalSales: 0, totalTransactions: 0, averageTransactionValue: 0, conversionRate: 0, salesPerVisitor: 0 };
        const totalSales = storeSummary.reduce((sum, s) => sum + s.totalSales, 0);
        const totalTransactions = storeSummary.reduce((sum, s) => sum + s.transactionCount, 0);
        const totalVisitors = storeSummary.reduce((sum, s) => sum + s.visitors, 0);
        const conversionRate = totalVisitors > 0 ? (totalTransactions / totalVisitors) * 100 : 0;
        const salesPerVisitor = totalVisitors > 0 ? totalSales / totalVisitors : 0;
        return { totalSales, totalTransactions, averageTransactionValue: totalTransactions > 0 ? totalSales / totalTransactions : 0, conversionRate, salesPerVisitor };
    }, [storeSummary]);
    
    const topEmployeesByAchievement = useMemo(() => {
        const allEmps = Object.values(employeeSummary).flat();
        return allEmps.map(emp => ({
            ...emp,
            achievement: (emp.target || 0) > 0 ? (emp.totalSales / emp.target) * 100 : 0
        })).sort((a, b) => b.achievement - a.achievement).slice(0, 10);
    }, [employeeSummary]);
    
    const salesOverTimeData = useMemo(() => {
        const salesByDate = filteredData.dailyMetrics.reduce((acc, metric) => {
            const date = normalizeDate(metric.date);
            if (date) {
                acc[date] = (acc[date] || 0) + Number(metric.totalSales || 0);
            }
            return acc;
        }, {});
        return Object.entries(salesByDate)
            .map(([date, sales]) => ({ date, sales }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }, [filteredData]);

    const handleSave = async (collectionName, data) => {
        if (!db) return;
        setIsProcessing(true);
        try {
            const ref = data.id
                ? doc(db, collectionName, data.id)
                : doc(collection(db, collectionName));
            const dataToSave = { ...data }; delete dataToSave.id;
            await setDoc(ref, dataToSave, { merge: true });
            setAppMessage({ isOpen: true, text: `${collectionName.slice(0, -1)} saved successfully!`, type: 'alert' });
        } catch (error) { setAppMessage({ isOpen: true, text: `Error: ${error.message}`, type: 'alert' }); }
        finally { setIsProcessing(false); setModalState({ type: null, data: null }); }
    };
    
    const handleDelete = async (collectionName, id) => {
        if (!db) return;
        const singularName = collectionName.slice(0, -1);
        setAppMessage({
            isOpen: true, text: `Are you sure you want to delete this ${singularName}?`, type: 'confirm', onConfirm: async () => {
                setIsProcessing(true);
                try {
                    await deleteDoc(doc(db, collectionName, id));
                    setAppMessage({ isOpen: true, text: `${singularName} deleted.`, type: 'alert' });
                } catch (error) { console.error(`Error deleting ${singularName}:`, error); }
                finally { setIsProcessing(false); }
            }
        });
    };
    
    const handleDeleteAllData = () => {
        if (!db) return;
        setAppMessage({
            isOpen: true,
            text: 'هل أنت متأكد؟ سيتم حذف جميع البيانات بشكل نهائي. لا يمكن التراجع عن هذا الإجراء.',
            type: 'confirm',
            onConfirm: async () => {
                setIsProcessing(true);
                setLoadingMessage("Deleting all data...");
                const collectionsToDelete = ['dailyMetrics', 'kingDuvetSales', 'salesTransactions', 'employees', 'stores', 'products'];
                
                try {
                    for (const collectionName of collectionsToDelete) {
                        setLoadingMessage(`Deleting ${collectionName}...`);
                        const querySnapshot = await getDocs(collection(db, collectionName));
                        const docsToDelete = querySnapshot.docs;

                        for (let i = 0; i < docsToDelete.length; i += 400) {
                            const batch = writeBatch(db);
                            const chunk = docsToDelete.slice(i, i + 400);
                            chunk.forEach(doc => batch.delete(doc.ref));
                            await batch.commit();
                        }
                    }
                    setAppMessage({ isOpen: true, text: 'تم حذف جميع البيانات بنجاح!', type: 'alert' });
                } catch (error) {
                    console.error("Error deleting all data:", error);
                    setAppMessage({ isOpen: true, text: `فشل حذف البيانات: ${error.message}`, type: 'alert' });
                } finally {
                    setIsProcessing(false);
                    setLoadingMessage("");
                }
            }
        });
    };

    const handleDailyMetricSave = async (metricData) => {
        if (!db) return;
        setIsProcessing(true);
        try {
            await addDoc(collection(db, 'dailyMetrics'), metricData);
            setAppMessage({ isOpen: true, text: 'Daily metrics recorded successfully!', type: 'alert' });
        } catch (error) { setAppMessage({ isOpen: true, text: `Error: ${error.message}`, type: 'alert' }); }
        finally { setIsProcessing(false); setModalState({ type: null, data: null }); }
    };
    
    const geminiFetchWithRetry = async (payload, maxRetries = 3) => {
        let retries = 0;
        let delay = 1000;

        while (retries < maxRetries) {
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (!res.ok) {
                    const errorBody = await res.json();
                    throw new Error(errorBody.error.message || 'AI analysis failed to respond.');
                }

                const result = await res.json();
                if (!result.candidates || !result.candidates[0].content || !result.candidates[0].content.parts[0].text) {
                    throw new Error("Invalid response structure from AI.");
                }
                return result.candidates[0].content.parts[0].text;
                
            } catch (error) {
                if (retries >= maxRetries - 1) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                retries++;
            }
        }
        throw new Error("AI analysis failed after multiple retries.");
    };

    const { handleSmartUpload, uploadResult, clearUploadResult } = useSmartUploader(db, setAppMessage, setIsProcessing, geminiFetchWithRetry);
    
    const handleEmployeeSelect = (employee) => {
        setSelectedEmployeeForDuvets(employee);
        setActiveTab('duvets');
    };

    const handleStoreSelect = (store) => {
        const fullStoreData = storeSummary.find(s => s.id === store.id);
        setSelectedStore(fullStoreData);
    };
    
    const isInitialLoading = !isAuthReady;

    if (isInitialLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-orange-600 mx-auto"></div>
                    <p className="mt-4 text-xl font-semibold text-zinc-700">{loadingMessage}</p>
                </div>
            </div>
        );
    }
    
    const renderContent = () => {
        if (activeTab === 'stores' && selectedStore) {
            return <StoreDetailPage store={selectedStore} allMetrics={dailyMetrics} onBack={() => setSelectedStore(null)} geminiFetch={geminiFetchWithRetry} dateFilter={dateFilter} setDateFilter={setDateFilter} />;
        }
        
        switch (activeTab) {
            case 'dashboard': return <Dashboard isLoading={isLoading} kpiData={kpiData} storeSummary={storeSummary} topEmployeesByAchievement={topEmployeesByAchievement} dateFilter={dateFilter} setDateFilter={setDateFilter} salesOverTimeData={salesOverTimeData} allProducts={allProducts} allData={dailyMetrics} setModalState={setModalState} />;
            case 'lfl': return <LFLPage lflData={lflData} allStores={allStores} lflStoreFilter={lflStoreFilter} setLflStoreFilter={setLflStoreFilter} lflMonthFilter={lflMonthFilter} setLflMonthFilter={setLflMonthFilter} />;
            case 'stores': return <StoresPage isLoading={isLoading} storeSummary={storeSummary} onAddSale={() => setModalState({ type: 'dailyMetric', data: { mode: 'store' } })} onAddStore={() => setModalState({ type: 'store', data: null })} onEditStore={(d) => setModalState({ type: 'store', data: d })} onDeleteStore={(id) => handleDelete('stores', id)} onSelectStore={handleStoreSelect} dateFilter={dateFilter} setDateFilter={setDateFilter} allData={dailyMetrics} />;
            case 'employees': return <EmployeesPage isLoading={isLoading} employeeSummary={employeeSummary} onAddEmployee={() => setModalState({ type: 'employee', data: null })} onEditEmployee={(d) => setModalState({ type: 'employee', data: d })} onDeleteEmployee={(id) => handleDelete('employees', id)} onAddSale={(d) => setModalState({ type: 'dailyMetric', data: d })} setModalState={setModalState} dateFilter={dateFilter} setDateFilter={setDateFilter} allData={dailyMetrics} salesTransactions={filteredData.salesTransactions} kingDuvetSales={filteredData.kingDuvetSales} storeSummary={storeSummary} />;
            case 'commissions': return <CommissionsPage storeSummary={storeSummary} employeeSummary={employeeSummary} />;
            case 'products': return <ProductsPage allProducts={allProducts} dateFilter={dateFilter} setDateFilter={setDateFilter} allData={salesTransactions.concat(kingDuvetSales)} setModalState={setModalState}/>;
            case 'duvets': return <DuvetsPage allDuvetSales={filteredData.kingDuvetSales} employees={allEmployees} selectedEmployee={selectedEmployeeForDuvets} onBack={() => setSelectedEmployeeForDuvets(null)} />;
            case 'uploads': return <SmartUploader onUpload={(data, setProgress) => handleSmartUpload(data, allStores, allEmployees, setProgress)} isProcessing={isProcessing} geminiFetchWithRetry={geminiFetchWithRetry} uploadResult={uploadResult} onClearResult={clearUploadResult} />;
            case 'ai-analysis': return <AiAnalysisPage geminiFetch={geminiFetchWithRetry} kpiData={kpiData} storeSummary={storeSummaryForExport} employeeSummary={employeeSummaryForExport} allProducts={allProducts} salesTransactions={filteredData.salesTransactions} kingDuvetSales={filteredData.kingDuvetSales} />;
            case 'settings': return <SettingsPage onDeleteAllData={handleDeleteAllData} isProcessing={isProcessing} employeeSummary={employeeSummaryForExport} storeSummary={storeSummaryForExport} allDuvetSales={allDuvetSalesForExport} />;
            default: return <div className="text-center p-8 bg-white rounded-lg">Page not found.</div>;
        }
    };
    
    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            <style>{`
                .modal-backdrop { position: fixed; inset: 0; background-color: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 1rem; }
                .modal-content { background: white; border-radius: 0.75rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); width: 100%; max-width: 28rem; padding: 1.5rem; }
                .modal-title { font-size: 1.5rem; font-weight: bold; margin-bottom: 1rem; }
                .modal-actions { margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem; }
                .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; }
                .input { margin-top: 0.25rem; display: block; width: 100%; padding: 0.5rem; border: 1px solid #D1D5DB; border-radius: 0.375rem; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
                .btn-primary { padding: 0.5rem 1rem; background-color: #2563EB; color: white; border-radius: 0.375rem; font-weight: 600; border: none; cursor: pointer; transition: background-color 0.2s; }
                .btn-primary:hover { background-color: #1D4ED8; }
                .btn-primary:disabled { background-color: #93C5FD; cursor: not-allowed; }
                .btn-secondary { padding: 0.5rem 1rem; background-color: #E5E7EB; color: #374151; border-radius: 0.375rem; font-weight: 600; border: none; cursor: pointer; transition: background-color 0.2s; }
                .btn-secondary:hover { background-color: #D1D5DB; }
                .btn-green { padding: 0.5rem 1rem; background-color: #059669; color: white; border-radius: 0.375rem; font-weight: 600; border: none; cursor: pointer; transition: background-color 0.2s; }
                .btn-green:hover { background-color: #047857; }
                .btn-danger { padding: 0.5rem 1rem; background-color: #DC2626; color: white; border-radius: 0.375rem; font-weight: 600; border: none; cursor: pointer; transition: background-color 0.2s; }
                .btn-danger:hover { background-color: #B91C1C; }
                .file-input { display: block; width: 100%; border: 1px solid #ccc; border-radius: 0.375rem; padding: 0.5rem; }
                .th { padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; font-weight: 600; color: #4B5563; text-transform: uppercase; }
                .td { padding: 1rem 1rem; white-space: nowrap; font-size: 0.875rem; }
                .date-filter-btn { padding: 0.5rem 1rem; border-radius: 9999px; font-weight: 500; border: 1px solid transparent; cursor: pointer; transition: all 0.2s; }
                .date-filter-btn-active { background-color: #F97316; color: white; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1); }
                .date-filter-btn-inactive { background-color: #F3F4F6; color: #374151; hover:bg-gray-300; }
                .kpi-card { transition: transform 0.2s, box-shadow 0.2s; }
                .kpi-card:hover { transform: translateY(-3px); box-shadow: 0 4px 12px -1px rgba(0,0,0,0.1); }
                tbody tr { transition: background-color 0.2s; }
                tbody tr:hover { background-color: #F9FAFB; }
                .prose { max-width: 100%; }
                @keyframes fade-in {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
            `}</style>
            <div className="relative md:flex">
                {/* Mobile Overlay */}
                {isSidebarOpen && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
                        onClick={() => setIsSidebarOpen(false)}
                    ></div>
                )}
                <aside className={`w-64 bg-white shadow-lg h-screen p-6 flex flex-col fixed inset-y-0 left-0 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out z-30`}>
                    <div className="flex items-center mb-10"><div className="bg-orange-600 text-white rounded-lg flex items-center justify-center w-12 h-12"><span className="text-2xl font-bold">K</span></div><h1 className="text-xl font-bold text-zinc-800 ml-3">Alsani Cockpit</h1></div>
                    <nav className="flex-grow overflow-y-auto">
                        <ul>
                            <NavItem icon={<HomeIcon />} label="Dashboard" name="dashboard" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<SparklesIcon />} label="AI Analysis" name="ai-analysis" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<ChartBarIcon />} label="LFL Comparison" name="lfl" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<OfficeBuildingIcon />} label="Stores" name="stores" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<UserGroupIcon />} label="Employees" name="employees" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<CalculatorIcon />} label="Commissions" name="commissions" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<CubeIcon />} label="Products" name="products" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<DuvetIcon />} label="Duvets" name="duvets" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<UploadIcon />} label="Smart Upload" name="uploads" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                            <NavItem icon={<CogIcon />} label="Settings" name="settings" activeTab={activeTab} setActiveTab={setActiveTab} setIsSidebarOpen={setIsSidebarOpen} />
                        </ul>
                    </nav>
                    <div className="mt-auto"><p className="text-xs text-gray-400 mt-4 text-center">Developed by Khalil Alsani</p></div>
                </aside>
                <main className="flex-1 p-4 sm:p-8 md:ml-64">
                    <header className="flex justify-between items-center mb-8">
                        <button className="md:hidden p-2 text-zinc-600" onClick={() => setIsSidebarOpen(true)}>
                            <MenuIcon />
                        </button>
                        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-800 capitalize flex-1 text-center md:text-left">{activeTab.replace(/([A-Z])/g, ' $1').replace('ai', 'AI')}</h2>
                    </header>
                    <ErrorBoundary>
                        {renderContent()}
                    </ErrorBoundary>
                </main>
            </div>

            {/* Modals */}
            {modalState.type &&
                <div className="modal-backdrop">
                    {modalState.type === 'employee' && <EmployeeModal data={modalState.data} onSave={(data) => handleSave('employees', data)} onClose={() => setModalState({ type: null, data: null })} isProcessing={isProcessing} stores={allStores} />}
                    {modalState.type === 'store' && <StoreModal data={modalState.data} onSave={(data) => handleSave('stores', data)} onClose={() => setModalState({ type: null, data: null })} isProcessing={isProcessing} />}
                    {modalState.type === 'product' && <ProductModal data={modalState.data} onSave={(data) => handleSave('products', data)} onClose={() => setModalState({ type: null, data: null })} isProcessing={isProcessing} />}
                    {modalState.type === 'dailyMetric' && <DailyMetricModal data={modalState.data} onSave={handleDailyMetricSave} onClose={() => setModalState({ type: null, data: null })} isProcessing={isProcessing} stores={allStores} />}
                    {modalState.type === 'aiCoaching' && <AiCoachingModal data={modalState.data} geminiFetch={geminiFetchWithRetry} onClose={() => setModalState({ type: null, data: null })} />}
                    {modalState.type === 'salesForecast' && <SalesForecastModal salesData={modalState.data} geminiFetch={geminiFetchWithRetry} onClose={() => setModalState({ type: null, data: null })} />}
                    {modalState.type === 'salesPitch' && <SalesPitchModal product={modalState.data} geminiFetch={geminiFetchWithRetry} onClose={() => setModalState({ type: null, data: null })} />}
                </div>
            }
            {appMessage.isOpen && <AppMessageModal message={appMessage} onClose={() => setAppMessage({ isOpen: false, text: '', type: 'alert', onConfirm: null })} />}
        </div>
    );
};

export default App;


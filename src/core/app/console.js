const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');  // 引入 dayjs
const utc = require('dayjs/plugin/utc');  // 引入 UTC 插件
const timezone = require('dayjs/plugin/timezone');  // 引入 timezone 插件

// 使用插件
dayjs.extend(utc);
dayjs.extend(timezone);

// 获取日志文件路径
const logDirectory = path.join(process.env.FEIBIJIUBI_FOLDER_PATH, 'logs');
const logFileName = 'FeibiJiubi';
const maxLogSize = 5 * 1024 * 1024;
const logRetentionDays = 8; // 保留 8 天的日志
const currentDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD'); // 获取当前日期并格式化为 UTC+8 时间
const logFilePath = path.join(logDirectory, `${logFileName}-${currentDate}.log`); // 按日期命名日志文件

// 确保日志文件夹存在
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

// 终端/管道输出中文乱码修复（Windows）：
// - TTY（真实控制台）下 Node 用 WriteConsoleW 输出 Unicode，直接写字符串即可；
// - 非 TTY（被 IDE 终端/管道重定向捕获）时，字节会按系统代码页解析，UTF-8 在 GBK 环境会乱码，
//   因此按系统 ANSI 代码页（中文环境为 936=GBK）转码后再写。日志文件同样按系统代码页写出，
//   保证在 GBK 控制台 `type` 与记事本中都能正常显示。
const iconv = require('iconv-lite');
let sysEnc = 'utf8';
if (process.platform === 'win32') {
  try {
    const cpOut = require('child_process').execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage" /v ACP',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /ACP\s+REG_SZ\s+(\d+)/.exec(cpOut);
    const acp = m ? m[1] : '936';
    const map = { '936': 'gbk', '949': 'euc-kr', '950': 'big5', '932': 'shift_jis' };
    sysEnc = map[acp] || 'gbk';
  } catch (e) { sysEnc = 'gbk'; }
}
const isConsoleTTY = !!process.stdout.isTTY;
// 转码：TTY 直接返回字符串（走 WriteConsoleW Unicode）；非 TTY/写文件则返回对应代码页的 Buffer
function enc(str, target) {
  if (target === 'utf8') return str;
  try { return iconv.encode(str, target); } catch (e) { return str; }
}
const FILE_ENC = process.platform === 'win32' ? sysEnc : 'utf8';
const CONSOLE_ENC = (process.platform === 'win32' && !isConsoleTTY) ? sysEnc : 'utf8';

let logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
// 检查日志文件大小并进行轮转
function checkLogFileSize() {
    fs.stat(logFilePath, (err, stats) => {
        if (err) return;
        // 如果日志文件大小超过了最大值，则进行轮转
        if (stats.size >= maxLogSize) {
            const archivedLogFilePath = path.join(logDirectory, `${logFileName}-${currentDate}-${Date.now()}.log`);
            fs.renameSync(logFilePath, archivedLogFilePath);
            logStream.close();
            logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        }
    });
}

// 删除超过保留期限的日志文件
function deleteOldLogs() {
    fs.readdir(logDirectory, (err, files) => {
        if (err) return;

        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(logDirectory, file);
            const stats = fs.statSync(filePath);
            // 如果文件是日志文件且超过保留期限，则删除
            if (file.startsWith(logFileName) && stats.isFile()) {
                const fileAgeDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24); // 计算文件的年龄（天）
                if (fileAgeDays > logRetentionDays) {
                    fs.unlinkSync(filePath); // 删除过期日志文件
                    console.log(`Deleted old log file: ${file}`);
                }
            }
        });
    });
}

deleteOldLogs(); // 删除旧的日志文件

// 获取当前时间并格式化为 UTC+8 时间
function getTimestamp() {
    return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
}

// 重定向 console.log、console.error 输出到日志文件与终端
function emit(line) {
    logStream.write(enc(line, FILE_ENC)); // 日志文件按系统代码页写出
    checkLogFileSize();
}
console.log = function (...args) {
    const timestamp = getTimestamp();  // 获取 UTC+8 时间戳
    const message = args.join(' ');  // 合并所有参数为一个字符串
    const line = `[${timestamp}] LOG: ${message}\n`;
    emit(line);
    process.stdout.write(enc(line, CONSOLE_ENC)); // 在控制台显示（按需转码）
};

console.error = function (...args) {
    const timestamp = getTimestamp();
    const message = args.join(' ');
    const line = `[${timestamp}] ERROR: ${message}\n`;
    emit(line);
    process.stderr.write(enc(line, CONSOLE_ENC));
};

console.warn = function (...args) {
    const timestamp = getTimestamp();
    const message = args.join(' ');
    const line = `[${timestamp}] WARN: ${message}\n`;
    emit(line);
    process.stderr.write(enc(line, CONSOLE_ENC));
};

console.info = function (...args) {
    const timestamp = getTimestamp();
    const message = args.join(' ');  // 合并所有参数为一个字符串
    const line = `[${timestamp}] INFO: ${message}\n`;
    emit(line);
    process.stdout.write(enc(line, CONSOLE_ENC));
};

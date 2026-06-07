const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// ========== ПРОВЕРКА ТОКЕНА ==========
console.log('🔍 Проверка конфигурации...');
console.log('Token loaded:', process.env.DISCORD_TOKEN ? '✅ Да' : '❌ НЕТ');
console.log('Owner ID loaded:', process.env.OWNER_ID ? '✅ Да' : '❌ НЕТ');

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ОШИБКА: Токен не найден в .env файле!');
    console.error('Создай файл .env и добавь туда:');
    console.error('DISCORD_TOKEN=твой_токен');
    console.error('OWNER_ID=твой_discord_id');
    process.exit(1);
}

if (!process.env.OWNER_ID) {
    console.error('❌ ОШИБКА: OWNER_ID не найден в .env файле!');
    console.error('Добавь в .env файл: OWNER_ID=твой_discord_id');
    process.exit(1);
}

// ========== НАСТРОЙКИ ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const YOUR_USER_ID = process.env.OWNER_ID;

// ID каналов и ролей
const CHANNEL_CREATE_GATHERING = '1511716864714342561';
const CHANNEL_GATHERING_ANNOUNCE = '1465836228875391026';
const CHANNEL_MODERATION = '1511716991864668241';
const HIGH_ROLE_ID = '1502022986499362976';

// ========== БАЗА ДАННЫХ ==========
const db = new sqlite3.Database('./data.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS player_points (
        user_id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        username TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS gatherings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        points INTEGER,
        organizer_id TEXT,
        message_id TEXT,
        channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS screenshot_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gathering_id INTEGER,
        user_id TEXT,
        screenshot_url TEXT,
        comment TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS milestone_notified (
        user_id TEXT,
        milestone INTEGER,
        notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, milestone)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS milestone_drop_notified (
        user_id TEXT,
        milestone INTEGER,
        notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, milestone)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS points_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        change INTEGER,
        new_points INTEGER,
        reason TEXT,
        moderator_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('✅ База данных инициализирована');
});

// ========== ФУНКЦИИ ДЛЯ БАЛЛОВ (с поддержкой минуса) ==========
function getUserPoints(userId, callback) {
    db.get('SELECT points FROM player_points WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Ошибка получения баллов:', err);
            callback(0);
        } else {
            callback(row ? row.points : 0);
        }
    });
}

// Выдача баллов (может уходить в плюс)
function addPoints(userId, points, username, callback) {
    db.get('SELECT points FROM player_points WHERE user_id = ?', [userId], (err, row) => {
        const currentPoints = row ? row.points : 0;
        const newPoints = currentPoints + points; // Может уходить в плюс
        
        db.run(`INSERT INTO player_points (user_id, points, username) 
                VALUES (?, ?, ?) 
                ON CONFLICT(user_id) DO UPDATE SET 
                points = ?, 
                username = ?,
                last_updated = CURRENT_TIMESTAMP`,
                [userId, newPoints, username, newPoints, username], 
                function(err) {
                    if (err) {
                        console.error('Ошибка выдачи баллов:', err);
                        if (callback) callback(false);
                    } else {
                        if (callback) callback(true, currentPoints, newPoints);
                        // Проверяем достижение 1000 баллов
                        if (newPoints >= 1000 && currentPoints < 1000) {
                            checkMilestone(userId, username);
                        }
                    }
                });
    });
}

// Снятие баллов (может уходить в минус)
function removePoints(userId, points, username, callback) {
    db.get('SELECT points FROM player_points WHERE user_id = ?', [userId], (err, row) => {
        const currentPoints = row ? row.points : 0;
        const newPoints = currentPoints - points; // Может уходить в минус
        
        db.run(`INSERT INTO player_points (user_id, points, username) 
                VALUES (?, ?, ?) 
                ON CONFLICT(user_id) DO UPDATE SET 
                points = ?, 
                username = ?,
                last_updated = CURRENT_TIMESTAMP`,
                [userId, newPoints, username, newPoints, username], 
                function(err) {
                    if (err) {
                        console.error('Ошибка снятия баллов:', err);
                        if (callback) callback(false);
                    } else {
                        if (callback) callback(true, currentPoints, newPoints);
                        // Проверяем падение ниже 1000 баллов
                        if (currentPoints >= 1000 && newPoints < 1000) {
                            checkMilestoneDrop(userId, username, currentPoints, newPoints);
                        }
                    }
                });
    });
}

function logPointsHistory(userId, change, newPoints, reason, moderatorId) {
    db.run(`INSERT INTO points_history (user_id, change, new_points, reason, moderator_id) 
            VALUES (?, ?, ?, ?, ?)`, [userId, change, newPoints, reason, moderatorId], (err) => {
        if (err) console.error('Ошибка записи истории:', err);
    });
}

async function checkMilestone(userId, username) {
    getUserPoints(userId, async (points) => {
        if (points >= 1000) {
            db.get('SELECT * FROM milestone_notified WHERE user_id = ? AND milestone = 1000', [userId], async (err, row) => {
                if (!row) {
                    const channel = await client.channels.fetch(CHANNEL_MODERATION).catch(() => null);
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setTitle('🏆 ДОСТИЖЕНИЕ 1000 БАЛЛОВ!')
                            .setColor(0xFFA500)
                            .setDescription(`Игрок ${username} (<@${userId}>) достиг **1000 баллов**!`)
                            .addFields(
                                { name: '📊 Текущие баллы', value: `${points}`, inline: true },
                                { name: '👑 Требуется действие', value: `Выдайте ему роль МЭЙН вручную`, inline: true }
                            )
                            .setTimestamp();
                        
                        await channel.send({ 
                            content: `<@&${HIGH_ROLE_ID}>`, 
                            embeds: [embed] 
                        });
                        
                        db.run('INSERT INTO milestone_notified (user_id, milestone) VALUES (?, ?)', [userId, 1000]);
                    }
                }
            });
        }
    });
}

async function checkMilestoneDrop(userId, username, oldPoints, newPoints) {
    if (oldPoints >= 1000 && newPoints < 1000) {
        db.get('SELECT * FROM milestone_drop_notified WHERE user_id = ? AND milestone = 1000', [userId], async (err, row) => {
            if (!row) {
                const channel = await client.channels.fetch(CHANNEL_MODERATION).catch(() => null);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ ПОТЕРЯ РАНГА МЭЙН')
                        .setColor(0xFF0000)
                        .setDescription(`Игрок ${username} (<@${userId}>) **потерял ранг МЭЙН**!`)
                        .addFields(
                            { name: '📊 Было баллов', value: `${oldPoints}`, inline: true },
                            { name: '📉 Стало баллов', value: `${newPoints}`, inline: true },
                            { name: '👑 Требуется действие', value: `Снимите с него роль МЭЙН вручную`, inline: false }
                        )
                        .setTimestamp();
                    
                    await channel.send({ 
                        content: `<@&${HIGH_ROLE_ID}>`, 
                        embeds: [embed] 
                    });
                    
                    db.run('INSERT INTO milestone_drop_notified (user_id, milestone) VALUES (?, ?)', [userId, 1000]);
                }
            }
        });
    }
}

// ========== ХРАНИЛИЩА ==========
const userScreenshots = new Map();
const pendingScreenshots = new Map();
let blacklist = new Map();

// ========== ЧЁРНЫЙ СПИСОК ==========
function loadBlacklist() {
    try {
        if (fs.existsSync('blacklist.json')) {
            const data = fs.readFileSync('blacklist.json', 'utf8');
            const blacklistObj = JSON.parse(data);
            blacklist = new Map(Object.entries(blacklistObj));
            console.log(`📋 Чёрный список загружен. Заблокировано: ${blacklist.size}`);
        } else {
            console.log('📋 Файл чёрного списка не найден, создаю...');
            saveBlacklist();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки чёрного списка:', error);
    }
}

function saveBlacklist() {
    try {
        const blacklistObj = Object.fromEntries(blacklist);
        fs.writeFileSync('blacklist.json', JSON.stringify(blacklistObj, null, 2));
        console.log(`💾 Чёрный список сохранён. Заблокировано: ${blacklist.size}`);
    } catch (error) {
        console.error('❌ Ошибка сохранения чёрного списка:', error);
    }
}

function isBlacklisted(userId) {
    return blacklist.has(userId);
}

function getBlacklistReason(userId) {
    const entry = blacklist.get(userId);
    return entry ? entry.reason : null;
}

async function addToBlacklist(userId, reason, client) {
    blacklist.set(userId, {
        reason: reason || 'Не указана',
        date: new Date().toISOString()
    });
    saveBlacklist();
    
    try {
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Вы добавлены в чёрный список')
            .setColor(0xFF0000)
            .setDescription('Ваши действия нарушили правила, и вы были заблокированы.')
            .addFields(
                { name: '📝 Причина', value: reason || 'Не указана', inline: false },
                { name: '📅 Дата блокировки', value: new Date().toLocaleString('ru-RU'), inline: false },
                { name: '❓ Что делать?', value: 'Обратитесь к администратору.', inline: false }
            );
        await user.send({ embeds: [embed] });
    } catch (error) {
        console.log(`❌ Не удалось отправить ЛС ${userId}:`, error.message);
    }
}

async function removeFromBlacklist(userId, client) {
    const userData = blacklist.get(userId);
    blacklist.delete(userId);
    saveBlacklist();
    
    if (userData) {
        try {
            const user = await client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle('✅ Вы удалены из чёрного списка')
                .setColor(0x00FF00)
                .setDescription('Ваша блокировка снята!')
                .addFields(
                    { name: '✅ Что теперь?', value: 'Можете отправлять заявки через `!form`', inline: false }
                );
            await user.send({ embeds: [embed] });
        } catch (error) {
            console.log(`❌ Не удалось отправить ЛС ${userId}:`, error.message);
        }
    }
}

function hasHighRole(member) {
    return member.roles.cache.has(HIGH_ROLE_ID);
}

// ========== СОЗДАНИЕ ПОСТОЯННЫХ КНОПОК (ТРИ КНОПКИ) ==========
async function setupGatheringButton() {
    const channel = await client.channels.fetch(CHANNEL_CREATE_GATHERING).catch(() => null);
    if (!channel) {
        console.error(`❌ Не найден канал: ${CHANNEL_CREATE_GATHERING}`);
        return;
    }
    
    let buttonMessage = null;
    const messages = await channel.messages.fetch({ limit: 10 });
    buttonMessage = messages.find(m => m.author.id === client.user.id && m.components?.length > 0);
    
    // ТРИ КНОПКИ в одном ряду
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_gathering')
            .setLabel('🎯 СОЗДАТЬ СБОР')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('add_points_menu')
            .setLabel('➕ ВЫДАТЬ БАЛЛЫ')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('remove_points_menu')
            .setLabel('📉 СНЯТЬ БАЛЛЫ')
            .setStyle(ButtonStyle.Danger)
    );
    
    const embed = new EmbedBuilder()
        .setTitle('🎮 УПРАВЛЕНИЕ СИСТЕМОЙ БАЛЛОВ')
        .setColor(0x00FF00)
        .setDescription('Нажмите на кнопку ниже, чтобы выполнить действие')
        .addFields(
            { name: '🎯 СОЗДАТЬ СБОР', value: 'Создать новый сбор для начисления баллов', inline: false },
            { name: '➕ ВЫДАТЬ БАЛЛЫ', value: 'Выдать баллы игроку (поощрение, бонус)', inline: false },
            { name: '📉 СНЯТЬ БАЛЛЫ', value: 'Списать баллы у игрока (неявка, нарушение)', inline: false }
        )
        .setFooter({ text: 'Только для роли High | Баллы могут уходить в минус' });
    
    if (buttonMessage) {
        await buttonMessage.edit({ embeds: [embed], components: [row] });
        console.log('✅ Кнопки обновлены');
    } else {
        await channel.send({ embeds: [embed], components: [row] });
        console.log('✅ Кнопки созданы');
    }
}

// ========== СОБЫТИЕ ГОТОВНОСТИ ==========
client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📨 Заявки на финансирование → <@${YOUR_USER_ID}>`);
    console.log(`💰 Максимальная сумма: 100 000 ₽`);
    console.log(`🎮 Система сборов активна!`);
    console.log(`📊 Баллы могут уходить в минус`);
    loadBlacklist();
    setupGatheringButton();
});

// ========== КОМАНДЫ ==========
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Команды для владельца (чёрный список)
    if (message.author.id === YOUR_USER_ID) {
        if (message.content === '!чс помощь') {
            const embed = new EmbedBuilder()
                .setTitle('📋 Управление чёрным списком')
                .setColor(0xFF0000)
                .addFields(
                    { name: '!чс добавить @user причина', value: 'Добавить в ЧС', inline: false },
                    { name: '!чс удалить @user', value: 'Удалить из ЧС', inline: false },
                    { name: '!чс список', value: 'Показать ЧС', inline: false },
                    { name: '!чс очистить', value: 'Очистить ЧС', inline: false }
                );
            const reply = await message.reply({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return message.delete().catch(() => {});
        }
        
        if (message.content.startsWith('!чс добавить')) {
            const args = message.content.split(' ');
            const mention = args[2];
            const userId = mention ? mention.replace(/[<@!>]/g, '') : null;
            const reason = args.slice(3).join(' ') || 'Не указана';
            if (!userId) {
                const reply = await message.reply('❌ !чс добавить @user причина');
                setTimeout(() => reply.delete().catch(() => {}), 10000);
                return message.delete().catch(() => {});
            }
            await addToBlacklist(userId, reason, client);
            const reply = await message.reply(`✅ <@${userId}> добавлен в ЧС`);
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return message.delete().catch(() => {});
        }
        
        if (message.content.startsWith('!чс удалить')) {
            const args = message.content.split(' ');
            const mention = args[2];
            const userId = mention ? mention.replace(/[<@!>]/g, '') : null;
            if (!userId) {
                const reply = await message.reply('❌ !чс удалить @user');
                setTimeout(() => reply.delete().catch(() => {}), 10000);
                return message.delete().catch(() => {});
            }
            await removeFromBlacklist(userId, client);
            const reply = await message.reply(`✅ <@${userId}> удалён из ЧС`);
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return message.delete().catch(() => {});
        }
        
        if (message.content === '!чс список') {
            if (blacklist.size === 0) {
                const reply = await message.reply('📋 ЧС пуст');
                setTimeout(() => reply.delete().catch(() => {}), 15000);
                return message.delete().catch(() => {});
            }
            const list = Array.from(blacklist.entries()).map(([id, data]) => `<@${id}> - ${data.reason}`).join('\n');
            const embed = new EmbedBuilder().setTitle('📋 ЧЁРНЫЙ СПИСОК').setDescription(list).setColor(0xFF0000);
            const reply = await message.reply({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(() => {}), 30000);
            return message.delete().catch(() => {});
        }
        
        if (message.content === '!чс очистить') {
            blacklist.clear();
            saveBlacklist();
            const reply = await message.reply('✅ ЧС очищен');
            setTimeout(() => reply.delete().catch(() => {}), 10000);
            return message.delete().catch(() => {});
        }
    }
    
    // Команда !form
    if (message.content === '!form') {
        if (isBlacklisted(message.author.id)) {
            const reply = await message.reply('⚠️ Вы в чёрном списке!');
            setTimeout(() => reply.delete().catch(() => {}), 15000);
            return message.delete().catch(() => {});
        }
        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_form').setLabel('📝 Заполнить заявку').setStyle(ButtonStyle.Primary)
        );
        await message.channel.send({ content: 'Нажми на кнопку, чтобы заполнить заявку:', components: [button] });
        await message.delete().catch(() => {});
    }
    
    // Команды для баллов
    if (message.content === '!баллы') {
        getUserPoints(message.author.id, (points) => {
            const embed = new EmbedBuilder().setTitle('💰 ВАШИ БАЛЛЫ').setColor(0x00FF00).setDescription(`У вас **${points}** баллов!`);
            message.reply({ embeds: [embed] });
        });
    }
    
    if (message.content === '!топ') {
        db.all('SELECT user_id, points, username FROM player_points ORDER BY points DESC LIMIT 10', (err, rows) => {
            if (err || rows.length === 0) return message.reply('📊 Топ пуст.');
            let description = '';
            rows.forEach((row, index) => {
                description += `${index + 1}. ${row.username || `<@${row.user_id}>`} — **${row.points}** баллов\n`;
            });
            const embed = new EmbedBuilder().setTitle('🏆 ТОП ИГРОКОВ').setColor(0xFFD700).setDescription(description);
            message.reply({ embeds: [embed] });
        });
    }
    
    if (message.content.startsWith('!история')) {
        const args = message.content.split(' ');
        const mention = args[1];
        const userId = mention ? mention.replace(/[<@!>]/g, '') : message.author.id;
        
        db.all(`SELECT * FROM points_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [userId], async (err, rows) => {
            if (err || rows.length === 0) {
                const reply = await message.reply(`📋 История для <@${userId}> пуста.`);
                setTimeout(() => reply.delete().catch(() => {}), 10000);
                return;
            }
            
            let description = '';
            rows.forEach(row => {
                const sign = row.change > 0 ? '+' : '';
                const date = new Date(row.created_at).toLocaleString('ru-RU');
                description += `**${sign}${row.change}** → ${row.new_points} | ${row.reason} | ${date}\n`;
            });
            
            const embed = new EmbedBuilder()
                .setTitle(`📋 ИСТОРИЯ БАЛЛОВ <@${userId}>`)
                .setColor(0x00AAFF)
                .setDescription(description)
                .setFooter({ text: 'Последние 10 изменений' });
            
            await message.reply({ embeds: [embed] });
        });
    }
});

// ========== СОЗДАНИЕ СБОРА (БЕЗ ЛИМИТА) ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'create_gathering') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasHighRole(member)) {
            return interaction.reply({ content: `❌ Требуется роль <@&${HIGH_ROLE_ID}>`, ephemeral: true });
        }
        
        const modal = new ModalBuilder().setCustomId(`create_gathering_modal_${interaction.user.id}`).setTitle('🎯 Создание сбора');
        const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Название сбора').setStyle(TextInputStyle.Short).setPlaceholder('Ограбление казино').setRequired(true);
        const pointsInput = new TextInputBuilder().setCustomId('points').setLabel('Количество баллов').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(pointsInput));
        await interaction.showModal(modal);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('create_gathering_modal_')) return;
    
    const title = interaction.fields.getTextInputValue('title');
    const points = parseInt(interaction.fields.getTextInputValue('points'));
    
    if (isNaN(points) || points < 1) {
        return interaction.reply({ content: '❌ Баллы должны быть положительным числом!', ephemeral: true });
    }
    
    // БЕЗ ЛИМИТА - создаём сбор сразу
    db.run(`INSERT INTO gatherings (title, points, organizer_id, is_active) VALUES (?, ?, ?, 1)`, [title, points, interaction.user.id], async function(err) {
        if (err) {
            console.error('Ошибка создания сбора:', err);
            return interaction.reply({ content: '❌ Ошибка при создании сбора', ephemeral: true });
        }
        
        const gatherId = this.lastID;
        const announceChannel = await client.channels.fetch(CHANNEL_GATHERING_ANNOUNCE);
        const rowBtn = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`submit_screenshot_${gatherId}`).setLabel('📸 ПРИКРЕПИТЬ СКРИН').setStyle(ButtonStyle.Primary)
        );
        const embed = new EmbedBuilder().setTitle('🎯 НОВЫЙ СБОР').setColor(0x00FF00).setDescription(`**${title}**`).addFields(
            { name: '🏆 Награда', value: `${points} баллов`, inline: true },
            { name: '👤 Организатор', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📌 Как участвовать', value: 'Нажмите кнопку и отправьте скрин в ЛС', inline: false }
        ).setFooter({ text: `ID: ${gatherId}` }).setTimestamp();
        
        const sentMessage = await announceChannel.send({ content: `@everyone`, embeds: [embed], components: [rowBtn] });
        db.run('UPDATE gatherings SET message_id = ?, channel_id = ? WHERE id = ?', [sentMessage.id, CHANNEL_GATHERING_ANNOUNCE, gatherId]);
        await interaction.reply({ content: `✅ Сбор "${title}" создан!`, ephemeral: true });
    });
});

// ========== ОТПРАВКА СКРИНА В ЛС ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('submit_screenshot_')) return;
    
    const gatheringId = parseInt(interaction.customId.replace('submit_screenshot_', ''));
    
    db.get('SELECT * FROM gatherings WHERE id = ? AND is_active = 1', [gatheringId], async (err, gathering) => {
        if (err || !gathering) {
            return interaction.reply({ content: '❌ Сбор не найден', ephemeral: true });
        }
        
        pendingScreenshots.set(interaction.user.id, {
            gatheringId: gatheringId,
            gatheringTitle: gathering.title,
            points: gathering.points,
            timestamp: Date.now()
        });
        
        await interaction.reply({
            content: `📸 **Отправьте скриншот в ЛС боту!**\n\n🎯 ${gathering.title}\n🏆 ${gathering.points} баллов\n\nУ вас 5 минут.`,
            ephemeral: true
        });
        
        setTimeout(() => pendingScreenshots.delete(interaction.user.id), 300000);
        
        try {
            await interaction.user.send(`📸 Отправьте скрин для сбора "${gathering.title}" (${gathering.points} баллов)`);
        } catch (e) {}
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;
    
    const pendingData = pendingScreenshots.get(message.author.id);
    if (!pendingData) return;
    
    if (!message.attachments?.size) {
        return message.reply('❌ Отправьте изображение');
    }
    
    const screenshot = message.attachments.find(att => att.contentType?.startsWith('image/'));
    if (!screenshot) {
        return message.reply('❌ Отправьте изображение (JPG, PNG, GIF)');
    }
    
    db.get('SELECT * FROM gatherings WHERE id = ? AND is_active = 1', [pendingData.gatheringId], async (err, gathering) => {
        if (err || !gathering) {
            await message.reply('❌ Сбор закрыт');
            pendingScreenshots.delete(message.author.id);
            return;
        }
        
        db.run(`INSERT INTO screenshot_requests (gathering_id, user_id, screenshot_url, comment, status) VALUES (?, ?, ?, ?, 'pending')`,
            [pendingData.gatheringId, message.author.id, screenshot.url, 'ЛС'],
            async function(err) {
                if (err) {
                    await message.reply('❌ Ошибка');
                    pendingScreenshots.delete(message.author.id);
                    return;
                }
                
                const modChannel = await client.channels.fetch(CHANNEL_MODERATION);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_screenshot_${this.lastID}_${pendingData.gatheringId}_${message.author.id}`).setLabel('✅ ВЫДАТЬ').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`deny_screenshot_${this.lastID}_${pendingData.gatheringId}_${message.author.id}`).setLabel('❌ ОТКАЗАТЬ').setStyle(ButtonStyle.Danger)
                );
                
                const embed = new EmbedBuilder().setTitle('📸 ЗАЯВКА').setColor(0xFFA500).addFields(
                    { name: '🎯 Сбор', value: gathering.title },
                    { name: '🏆 Баллы', value: `${gathering.points}` },
                    { name: '👤 Участник', value: `<@${message.author.id}>` },
                    { name: '📸 Скрин', value: `[Ссылка](${screenshot.url})` }
                ).setImage(screenshot.url).setTimestamp();
                
                await modChannel.send({ content: `<@&${HIGH_ROLE_ID}>`, embeds: [embed], components: [row] });
                await message.reply('✅ Скрин отправлен на проверку!');
                pendingScreenshots.delete(message.author.id);
            });
    });
});

// ========== ВЫДАЧА БАЛЛОВ ЧЕРЕЗ КНОПКУ ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'add_points_menu') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasHighRole(member)) {
            return interaction.reply({ content: `❌ Требуется роль <@&${HIGH_ROLE_ID}>`, ephemeral: true });
        }
        
        const modal = new ModalBuilder().setCustomId(`add_points_modal_${interaction.user.id}`).setTitle('➕ Выдача баллов');
        const userInput = new TextInputBuilder().setCustomId('user_id').setLabel('Пользователь (@ или ID)').setStyle(TextInputStyle.Short).setPlaceholder('@Вася').setRequired(true);
        const pointsInput = new TextInputBuilder().setCustomId('points').setLabel('Сколько баллов выдать?').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true);
        const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setPlaceholder('За участие в мероприятии').setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(pointsInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );
        await interaction.showModal(modal);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('add_points_modal_')) return;
    
    const userInput = interaction.fields.getTextInputValue('user_id');
    const points = parseInt(interaction.fields.getTextInputValue('points'));
    const reason = interaction.fields.getTextInputValue('reason');
    
    let userId = userInput.replace(/[<@!>]/g, '').trim();
    if (!userId.match(/^\d+$/)) {
        return interaction.reply({ content: '❌ Укажите корректного пользователя', ephemeral: true });
    }
    
    if (isNaN(points) || points <= 0) {
        return interaction.reply({ content: '❌ Баллы должны быть положительным числом', ephemeral: true });
    }
    
    let targetUser;
    try {
        targetUser = await client.users.fetch(userId);
    } catch (e) {
        return interaction.reply({ content: '❌ Пользователь не найден', ephemeral: true });
    }
    
    db.get('SELECT points FROM player_points WHERE user_id = ?', [userId], async (err, row) => {
        const currentPoints = row ? row.points : 0;
        
        addPoints(userId, points, targetUser.tag, async (success, oldPoints, newPoints) => {
            if (success) {
                logPointsHistory(userId, points, newPoints, reason, interaction.user.id);
                
                try {
                    await targetUser.send(`✅ **Вам начислено ${points} баллов!**\n📝 Причина: ${reason}\n📊 ${oldPoints} → ${newPoints} баллов`);
                } catch (e) {}
                
                await interaction.reply({ content: `✅ Выдано ${points} баллов ${targetUser.tag}\n${oldPoints} → ${newPoints} баллов`, ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Ошибка при выдаче баллов', ephemeral: true });
            }
        });
    });
});

// ========== СНЯТИЕ БАЛЛОВ ЧЕРЕЗ КНОПКУ ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'remove_points_menu') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!hasHighRole(member)) {
            return interaction.reply({ content: `❌ Требуется роль <@&${HIGH_ROLE_ID}>`, ephemeral: true });
        }
        
        const modal = new ModalBuilder().setCustomId(`remove_points_modal_${interaction.user.id}`).setTitle('📉 Снятие баллов');
        const userInput = new TextInputBuilder().setCustomId('user_id').setLabel('Пользователь (@ или ID)').setStyle(TextInputStyle.Short).setPlaceholder('@Вася').setRequired(true);
        const pointsInput = new TextInputBuilder().setCustomId('points').setLabel('Сколько баллов снять?').setStyle(TextInputStyle.Short).setPlaceholder('50').setRequired(true);
        const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setPlaceholder('Неявка в строй').setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(pointsInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );
        await interaction.showModal(modal);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('remove_points_modal_')) return;
    
    const userInput = interaction.fields.getTextInputValue('user_id');
    const points = parseInt(interaction.fields.getTextInputValue('points'));
    const reason = interaction.fields.getTextInputValue('reason');
    
    let userId = userInput.replace(/[<@!>]/g, '').trim();
    if (!userId.match(/^\d+$/)) {
        return interaction.reply({ content: '❌ Укажите корректного пользователя', ephemeral: true });
    }
    
    if (isNaN(points) || points <= 0) {
        return interaction.reply({ content: '❌ Баллы должны быть положительным числом', ephemeral: true });
    }
    
    let targetUser;
    try {
        targetUser = await client.users.fetch(userId);
    } catch (e) {
        return interaction.reply({ content: '❌ Пользователь не найден', ephemeral: true });
    }
    
    db.get('SELECT points FROM player_points WHERE user_id = ?', [userId], async (err, row) => {
        const currentPoints = row ? row.points : 0;
        
        removePoints(userId, points, targetUser.tag, async (success, oldPoints, newPoints) => {
            if (success) {
                logPointsHistory(userId, -points, newPoints, reason, interaction.user.id);
                
                try {
                    await targetUser.send(`⚠️ **Снято ${points} баллов**\n📝 Причина: ${reason}\n📊 ${oldPoints} → ${newPoints} баллов`);
                } catch (e) {}
                
                await interaction.reply({ content: `✅ Снято ${points} баллов у ${targetUser.tag}\n${oldPoints} → ${newPoints} баллов`, ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Ошибка при снятии баллов', ephemeral: true });
            }
        });
    });
});

// ========== ОБРАБОТКА РЕШЕНИЙ HIGH ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('approve_screenshot_')) return;
    
    const parts = interaction.customId.split('_');
    const requestId = parseInt(parts[2]);
    const gatheringId = parseInt(parts[3]);
    const userId = parts[4];
    
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!hasHighRole(member)) {
        return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
    }
    
    db.get('SELECT * FROM screenshot_requests WHERE id = ? AND status = "pending"', [requestId], async (err, request) => {
        if (err || !request) return interaction.reply({ content: '❌ Уже обработано', ephemeral: true });
        
        db.get('SELECT * FROM gatherings WHERE id = ?', [gatheringId], async (err, gathering) => {
            db.run('UPDATE screenshot_requests SET status = "approved", reviewed_by = ? WHERE id = ?', [interaction.user.id, requestId]);
            
            const user = await client.users.fetch(userId);
            addPoints(userId, gathering.points, user.tag, async () => {
                const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00).setTitle('✅ ОДОБРЕНО');
                await interaction.update({ embeds: [embed], components: [] });
                await user.send(`✅ +${gathering.points} баллов за сбор "${gathering.title}"`).catch(() => {});
                await interaction.followUp({ content: `✅ ${user.tag} +${gathering.points} баллов`, ephemeral: true });
            });
        });
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('deny_screenshot_')) return;
    
    const parts = interaction.customId.split('_');
    const requestId = parseInt(parts[2]);
    const userId = parts[4];
    
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!hasHighRole(member)) {
        return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
    }
    
    db.run('UPDATE screenshot_requests SET status = "denied", reviewed_by = ? WHERE id = ?', [interaction.user.id, requestId]);
    const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFF0000).setTitle('❌ ОТКЛОНЕНО');
    await interaction.update({ embeds: [embed], components: [] });
    
    const user = await client.users.fetch(userId);
    await user.send(`❌ Скрин отклонён`).catch(() => {});
    await interaction.followUp({ content: `❌ Отклонено`, ephemeral: true });
});

// ========== СТАРАЯ СИСТЕМА (ФИНАНСИРОВАНИЕ) ==========
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_form') return;
    
    if (isBlacklisted(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ Вы в ЧС', ephemeral: true });
    }
    
    const modal = new ModalBuilder().setCustomId(`money_form_${interaction.user.id}`).setTitle('💰 Заявка на финансирование');
    const amountInput = new TextInputBuilder().setCustomId('amount').setLabel('Сумма (до 100 000 ₽)').setStyle(TextInputStyle.Short).setPlaceholder('50 000').setRequired(true);
    const currentMoneyInput = new TextInputBuilder().setCustomId('current_money').setLabel('Текущие средства').setStyle(TextInputStyle.Short).setPlaceholder('10 000').setRequired(true);
    const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setPlaceholder('Подробная причина...').setRequired(true);
    modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(currentMoneyInput),
        new ActionRowBuilder().addComponents(reasonInput)
    );
    await interaction.showModal(modal);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('money_form_')) return;
    
    const amountRaw = interaction.fields.getTextInputValue('amount');
    const currentMoney = interaction.fields.getTextInputValue('current_money');
    const reason = interaction.fields.getTextInputValue('reason');
    const amountNum = parseInt(amountRaw.replace(/[^\d-]/g, ''), 10);
    
    if (isNaN(amountNum) || amountNum > 100000) {
        return interaction.reply({ content: '❌ Сумма до 100 000 ₽', ephemeral: true });
    }
    
    userScreenshots.set(interaction.user.id, {
        amount: amountRaw, currentMoney, reason, userName: interaction.user.tag, timestamp: Date.now()
    });
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`add_screenshot_${interaction.user.id}`).setLabel('📸 Добавить скрин').setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: `✅ Часть 1/2 заполнена!\n📝 ${amountRaw}\n💰 ${currentMoney}\n❓ ${reason}\n\nТеперь отправьте скрин в ЛС`, components: [row], ephemeral: true });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('add_screenshot_')) return;
    
    const userId = interaction.customId.replace('add_screenshot_', '');
    if (userId !== interaction.user.id) return interaction.reply({ content: '❌ Не ваша заявка', ephemeral: true });
    
    const formData = userScreenshots.get(userId);
    if (!formData) return interaction.reply({ content: '❌ Данные не найдены', ephemeral: true });
    
    await interaction.reply({ content: '📸 Отправьте скрин в ЛС боту', ephemeral: true });
    userScreenshots.set(userId, { ...formData, waitingForScreenshot: true });
    try { await interaction.user.send('📸 Отправьте скриншот ваших средств'); } catch (e) {}
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;
    
    const formData = userScreenshots.get(message.author.id);
    if (!formData?.waitingForScreenshot) return;
    if (!message.attachments?.size) return message.reply('❌ Отправьте изображение');
    
    const screenshot = message.attachments.find(att => att.contentType?.startsWith('image/'));
    if (!screenshot) return message.reply('❌ Отправьте изображение');
    
    const embed = new EmbedBuilder().setColor(0x00FF00).setTitle('📬 Заявка на финансирование')
        .setDescription(`<@${YOUR_USER_ID}>`).addFields(
            { name: '👤 От кого', value: formData.userName },
            { name: '💰 Сумма', value: formData.amount },
            { name: '💵 Средства', value: formData.currentMoney },
            { name: '❓ Причина', value: formData.reason },
            { name: '📸 Скрин', value: `[Ссылка](${screenshot.url})` }
        ).setImage(screenshot.url).setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${message.author.id}`).setLabel('✅ Одобрить').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`deny_${message.author.id}`).setLabel('❌ Отклонить').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ask_${message.author.id}`).setLabel('💬 Уточнить').setStyle(ButtonStyle.Secondary)
    );
    
    try {
        const owner = await client.users.fetch(YOUR_USER_ID);
        await owner.send({ embeds: [embed], components: [row] });
        await message.reply('✅ Заявка отправлена!');
        userScreenshots.delete(message.author.id);
    } catch (error) {
        await message.reply('❌ Ошибка');
        userScreenshots.delete(message.author.id);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'approve_' + interaction.customId.split('_')[1] && !interaction.customId.includes('screenshot')) {
        const userId = interaction.customId.replace('approve_', '');
        try { await (await client.users.fetch(userId)).send('✅ Заявка одобрена!'); } catch (e) {}
        await interaction.reply({ content: '✅ Одобрено', ephemeral: true });
        await interaction.message.edit({ components: [] });
    }
    if (interaction.customId.startsWith('deny_') && !interaction.customId.includes('screenshot')) {
        const userId = interaction.customId.replace('deny_', '');
        const modal = new ModalBuilder().setCustomId(`deny_reason_${userId}`).setTitle('Причина отказа');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId.startsWith('ask_')) {
        const userId = interaction.customId.replace('ask_', '');
        const modal = new ModalBuilder().setCustomId(`ask_question_${userId}`).setTitle('Уточнение');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('question').setLabel('Вопрос').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId.startsWith('deny_reason_')) {
        const userId = interaction.customId.replace('deny_reason_', '');
        const reason = interaction.fields.getTextInputValue('reason');
        try { await (await client.users.fetch(userId)).send(`❌ Отказ: ${reason}`); } catch (e) {}
        await interaction.reply({ content: '❌ Отказано', ephemeral: true });
    }
    if (interaction.customId.startsWith('ask_question_')) {
        const userId = interaction.customId.replace('ask_question_', '');
        const question = interaction.fields.getTextInputValue('question');
        try { await (await client.users.fetch(userId)).send(`💬 Вопрос: ${question}`); } catch (e) {}
        await interaction.reply({ content: '💬 Отправлено', ephemeral: true });
    }
});

client.login(TOKEN);

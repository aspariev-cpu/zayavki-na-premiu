const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

// ПРОВЕРКА ТОКЕНА ПЕРЕД ЗАПУСКОМ
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

// Хранилище временных данных для скриншотов
const userScreenshots = new Map();

// ЧЁРНЫЙ СПИСОК: { userId: { reason: string, date: string } }
let blacklist = new Map();

// Загрузка чёрного списка из файла
function loadBlacklist() {
    try {
        if (fs.existsSync('blacklist.json')) {
            const data = fs.readFileSync('blacklist.json', 'utf8');
            const blacklistObj = JSON.parse(data);
            blacklist = new Map(Object.entries(blacklistObj));
            console.log(`📋 Чёрный список загружен. Заблокировано пользователей: ${blacklist.size}`);
        } else {
            console.log('📋 Файл чёрного списка не найден, создаю новый...');
            saveBlacklist();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки чёрного списка:', error);
    }
}

// Сохранение чёрного списка в файл
function saveBlacklist() {
    try {
        const blacklistObj = Object.fromEntries(blacklist);
        fs.writeFileSync('blacklist.json', JSON.stringify(blacklistObj, null, 2));
        console.log(`💾 Чёрный список сохранён. Заблокировано: ${blacklist.size}`);
    } catch (error) {
        console.error('❌ Ошибка сохранения чёрного списка:', error);
    }
}

// Проверка в чёрном списке
function isBlacklisted(userId) {
    return blacklist.has(userId);
}

// Получить причину блокировки
function getBlacklistReason(userId) {
    const entry = blacklist.get(userId);
    return entry ? entry.reason : null;
}

// Добавление в чёрный список
function addToBlacklist(userId, reason) {
    blacklist.set(userId, {
        reason: reason || 'Не указана',
        date: new Date().toISOString()
    });
    saveBlacklist();
}

// Удаление из чёрного списка
function removeFromBlacklist(userId) {
    blacklist.delete(userId);
    saveBlacklist();
}

client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} запущен!`);
    console.log(`📨 Заявки будут приходить к <@${YOUR_USER_ID}>`);
    console.log(`💰 Максимальная сумма запроса: 100 000 ₽`);
    loadBlacklist();
});

// КОМАНДЫ
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // КОМАНДЫ ДЛЯ РАБОТЫ С ЧЁРНЫМ СПИСКОМ (только для владельца)
    if (message.author.id === YOUR_USER_ID) {
        
        // ПОМОЩЬ: !чс помощь
        if (message.content === '!чс помощь' || message.content === '!чс хелп') {
            const embed = new EmbedBuilder()
                .setTitle('📋 Управление чёрным списком')
                .setColor(0xFF0000)
                .addFields(
                    { name: '!чс добавить @user причина', value: '➕ Добавить пользователя в чёрный список', inline: false },
                    { name: '!чс удалить @user', value: '➖ Удалить пользователя из чёрного списка', inline: false },
                    { name: '!чс список', value: '📋 Показать всех заблокированных пользователей', inline: false },
                    { name: '!чс проверить @user', value: '🔍 Проверить, в чёрном ли списке пользователь', inline: false },
                    { name: '!чс очистить', value: '🗑️ Очистить весь чёрный список (с подтверждением)', inline: false }
                )
                .setFooter({ text: 'Только для владельца бота' });
            return message.reply({ embeds: [embed] });
        }
        
        // ДОБАВИТЬ: !чс добавить @user причина
        if (message.content.startsWith('!чс добавить')) {
            const args = message.content.split(' ');
            const mention = args[2];
            const userId = mention ? mention.replace(/[<@!>]/g, '') : null;
            const reason = args.slice(3).join(' ') || 'Не указана';
            
            if (!userId) {
                return message.reply('❌ **Как использовать:**\n`!чс добавить @пользователь причина блокировки`\n\nПример: `!чс добавить @Вася Спам заявками`');
            }
            
            if (isBlacklisted(userId)) {
                return message.reply(`⚠️ Пользователь <@${userId}> **УЖЕ** в чёрном списке!`);
            }
            
            addToBlacklist(userId, reason);
            return message.reply(`✅ **Пользователь добавлен в чёрный список!**\n\n👤 Пользователь: <@${userId}>\n📝 Причина: ${reason}`);
        }
        
        // УДАЛИТЬ: !чс удалить @user
        if (message.content.startsWith('!чс удалить')) {
            const args = message.content.split(' ');
            const mention = args[2];
            const userId = mention ? mention.replace(/[<@!>]/g, '') : null;
            
            if (!userId) {
                return message.reply('❌ **Как использовать:**\n`!чс удалить @пользователь`\n\nПример: `!чс удалить @Вася`');
            }
            
            if (!isBlacklisted(userId)) {
                return message.reply(`⚠️ Пользователь <@${userId}> **НЕ** в чёрном списке!`);
            }
            
            removeFromBlacklist(userId);
            return message.reply(`✅ **Пользователь удалён из чёрного списка!**\n\n👤 Пользователь: <@${userId}>`);
        }
        
        // СПИСОК: !чс список
        if (message.content === '!чс список') {
            if (blacklist.size === 0) {
                return message.reply('📋 **Чёрный список пуст.**\n\nВсе пользователи могут отправлять заявки.');
            }
            
            const list = Array.from(blacklist.entries()).map(([id, data], index) => {
                return `${index + 1}. <@${id}>\n   📝 Причина: ${data.reason}\n   📅 Дата: ${new Date(data.date).toLocaleString('ru-RU')}`;
            }).join('\n\n');
            
            const embed = new EmbedBuilder()
                .setTitle(`📋 ЧЁРНЫЙ СПИСОК (${blacklist.size} пользователей)`)
                .setColor(0xFF0000)
                .setDescription(list)
                .setTimestamp();
            
            return message.reply({ embeds: [embed] });
        }
        
        // ПРОВЕРИТЬ: !чс проверить @user
        if (message.content.startsWith('!чс проверить')) {
            const args = message.content.split(' ');
            const mention = args[2];
            const userId = mention ? mention.replace(/[<@!>]/g, '') : null;
            
            if (!userId) {
                return message.reply('❌ **Как использовать:**\n`!чс проверить @пользователь`\n\nПример: `!чс проверить @Вася`');
            }
            
            if (isBlacklisted(userId)) {
                const reason = getBlacklistReason(userId);
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ ПОЛЬЗОВАТЕЛЬ В ЧЁРНОМ СПИСКЕ')
                    .setColor(0xFF0000)
                    .addFields(
                        { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                        { name: '📝 Причина', value: reason, inline: true },
                        { name: '📅 Дата блокировки', value: new Date(blacklist.get(userId).date).toLocaleString('ru-RU'), inline: false }
                    );
                return message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('✅ ПОЛЬЗОВАТЕЛЬ НЕ В ЧЁРНОМ СПИСКЕ')
                    .setColor(0x00FF00)
                    .setDescription(`Пользователь <@${userId}> может отправлять заявки.`);
                return message.reply({ embeds: [embed] });
            }
        }
        
        // ОЧИСТИТЬ: !чс очистить
        if (message.content === '!чс очистить') {
            if (blacklist.size === 0) {
                return message.reply('📋 Чёрный список и так пуст.');
            }
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('clear_blacklist_confirm')
                    .setLabel('⚠️ ДА, ОЧИСТИТЬ ВЕСЬ СПИСОК')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('clear_blacklist_cancel')
                    .setLabel('❌ Отмена')
                    .setStyle(ButtonStyle.Secondary)
            );
            
            await message.reply({
                content: `⚠️ **ВНИМАНИЕ!** Вы собираетесь очистить весь чёрный список (${blacklist.size} пользователей).\n\nЭто действие нельзя отменить!`,
                components: [row]
            });
        }
    }
    
    // Обычная команда !form
    if (message.content === '!form') {
        // Проверка чёрного списка
        if (isBlacklisted(message.author.id)) {
            const reason = getBlacklistReason(message.author.id);
            return message.reply({
                content: `⚠️ **Вы в чёрном списке!**\n\n📝 Причина: ${reason}\n\nОбратитесь к администратору для снятия блокировки.`
            });
        }
        
        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_form')
                .setLabel('📝 Заполнить заявку')
                .setStyle(ButtonStyle.Primary)
        );

        await message.channel.send({
            content: 'Нажми на кнопку, чтобы заполнить заявку:',
            components: [button]
        });
    }
});

// Обработка кнопок подтверждения очистки чёрного списка
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'clear_blacklist_confirm') {
        const count = blacklist.size;
        blacklist.clear();
        saveBlacklist();
        
        await interaction.update({
            content: `✅ **Чёрный список очищен!** Удалено ${count} пользователей.`,
            components: []
        });
    }
    
    if (interaction.customId === 'clear_blacklist_cancel') {
        await interaction.update({
            content: `❌ Очистка чёрного списка отменена.`,
            components: []
        });
    }
});

// Обработка кнопки открытия формы
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_form') return;
    
    // Проверка чёрного списка
    if (isBlacklisted(interaction.user.id)) {
        const reason = getBlacklistReason(interaction.user.id);
        return interaction.reply({
            content: `⚠️ **Вы в чёрном списке!**\n\n📝 Причина: ${reason}\n\nОбратитесь к администратору для снятия блокировки.`,
            ephemeral: true
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`money_form_${interaction.user.id}`)
        .setTitle('💰 Заявка на финансирование');

    const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Сколько денег вам требуется? (до 100 000 ₽)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 50 000 ₽ (максимум 100 000 ₽)')
        .setRequired(true);

    const currentMoneyInput = new TextInputBuilder()
        .setCustomId('current_money')
        .setLabel('Сколько сейчас у вас средств?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 10 000 ₽')
        .setRequired(true);

    const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Зачем вам нужны эти деньги?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Напишите подробную причину...')
        .setRequired(true);

    const firstRow = new ActionRowBuilder().addComponents(amountInput);
    const secondRow = new ActionRowBuilder().addComponents(currentMoneyInput);
    const thirdRow = new ActionRowBuilder().addComponents(reasonInput);

    modal.addComponents(firstRow, secondRow, thirdRow);

    await interaction.showModal(modal);
});

// Обработка отправки формы (модальное окно)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('money_form_')) return;

    // Проверка чёрного списка
    if (isBlacklisted(interaction.user.id)) {
        const reason = getBlacklistReason(interaction.user.id);
        return interaction.reply({
            content: `⚠️ **Вы в чёрном списке!**\n\n📝 Причина: ${reason}\n\nОбратитесь к администратору.`,
            ephemeral: true
        });
    }

    const amountRaw = interaction.fields.getTextInputValue('amount');
    const currentMoney = interaction.fields.getTextInputValue('current_money');
    const reason = interaction.fields.getTextInputValue('reason');
    const userName = interaction.user.tag;
    const userId = interaction.user.id;

    // Проверка суммы (до 100 000)
    const amountNumber = parseInt(amountRaw.replace(/[^\d-]/g, ''), 10);
    
    if (isNaN(amountNumber) || amountNumber > 100000) {
        return interaction.reply({
            content: `❌ **Ошибка!**\n\nСумма запроса не может превышать **100 000 ₽**.\n\nВы указали: ${amountRaw}\n\n⚠️ **Напоминание:** Максимальная сумма для одной заявки — **100 000 ₽**.\n\nПожалуйста, начните заново с команды \`!form\` и укажите корректную сумму.`,
            ephemeral: true
        });
    }
    
    if (amountNumber <= 0) {
        return interaction.reply({
            content: `❌ **Ошибка!**\n\nСумма должна быть положительным числом.\n\nВы указали: ${amountRaw}\n\nПожалуйста, начните заново с команды \`!form\`.`,
            ephemeral: true
        });
    }

    userScreenshots.set(userId, {
        amount: amountRaw,
        currentMoney,
        reason,
        userName,
        timestamp: Date.now()
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`add_screenshot_${userId}`)
            .setLabel('📸 Добавить скриншот средств')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: `✅ **Часть 1/2 заполнена!**\n\n📝 Сумма: **${amountRaw}**\n💰 Текущие средства: **${currentMoney}**\n❓ Причина: ${reason}\n\n**Теперь отправьте скриншот ваших средств**\n\nНажмите на кнопку ниже:`,
        components: [row],
        ephemeral: true
    });
});

// Обработка кнопки добавления скриншота
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('add_screenshot_')) return;

    const userId = interaction.customId.replace('add_screenshot_', '');
    
    if (userId !== interaction.user.id) {
        return interaction.reply({
            content: '❌ Это не ваша заявка!',
            ephemeral: true
        });
    }
    
    // Проверка чёрного списка
    if (isBlacklisted(interaction.user.id)) {
        return interaction.reply({
            content: '⚠️ Вы в чёрном списке!',
            ephemeral: true
        });
    }

    const formData = userScreenshots.get(userId);
    if (!formData) {
        return interaction.reply({
            content: '❌ Данные заявки не найдены. Пожалуйста, начните заново с команды !form',
            ephemeral: true
        });
    }

    await interaction.reply({
        content: `📸 **Отправьте скриншот ваших средств!**\n\nПросто отправьте изображение в личные сообщения боту.`,
        ephemeral: true
    });

    userScreenshots.set(userId, { ...formData, waitingForScreenshot: true });
    
    try {
        await interaction.user.send(`📸 **Отправьте скриншот ваших средств сюда, чтобы завершить заявку.**`);
    } catch (e) {
        console.log('Не удалось отправить ЛС');
    }
});

// Обработка скриншотов в ЛС
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;
    
    const userId = message.author.id;
    const formData = userScreenshots.get(userId);
    
    if (!formData || !formData.waitingForScreenshot) return;
    
    // Проверка чёрного списка
    if (isBlacklisted(userId)) {
        return message.reply('⚠️ Вы в чёрном списке!');
    }
    
    if (!message.attachments || message.attachments.size === 0) {
        return message.reply('❌ Отправьте изображение.');
    }
    
    const screenshot = message.attachments.find(att => att.contentType?.startsWith('image/'));
    
    if (!screenshot) {
        return message.reply('❌ Отправьте изображение в формате JPG, PNG, GIF или WEBP.');
    }
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📬 Новая заявка на финансирование!')
        .setDescription(`<@${YOUR_USER_ID}>, поступила новая заявка`)
        .addFields(
            { name: '👤 От кого', value: `${formData.userName} (${userId})`, inline: false },
            { name: '💰 Требуемая сумма', value: formData.amount, inline: true },
            { name: '💵 Текущие средства', value: formData.currentMoney, inline: true },
            { name: '❓ Причина', value: formData.reason, inline: false },
            { name: '📸 Скриншот', value: `[Нажмите для просмотра](${screenshot.url})`, inline: false }
        )
        .setImage(screenshot.url)
        .setTimestamp()
        .setFooter({ text: 'Максимум 100 000 ₽' });
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_${userId}`)
            .setLabel('✅ Одобрить')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`deny_${userId}`)
            .setLabel('❌ Отклонить')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ask_${userId}`)
            .setLabel('💬 Уточнить')
            .setStyle(ButtonStyle.Secondary)
    );
    
    try {
        const owner = await client.users.fetch(YOUR_USER_ID);
        await owner.send({ embeds: [embed], components: [row] });
        
        await message.reply('✅ **Заявка отправлена!** Ответ придёт в ЛС.');
        userScreenshots.delete(userId);
        
    } catch (error) {
        console.error('Ошибка:', error);
        await message.reply('❌ Ошибка при отправке.');
        userScreenshots.delete(userId);
    }
});

// Обработка кнопок (одобрить/отклонить/уточнить)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('approve_')) {
        const userId = interaction.customId.replace('approve_', '');
        try {
            const user = await client.users.fetch(userId);
            await user.send('✅ **Ваша заявка одобрена!** Деньги будут выданы в ближайшее время.');
        } catch (e) {}
        await interaction.reply({ content: '✅ Заявка одобрена! Уведомление отправлено.', ephemeral: true });
        await interaction.message.edit({ components: [] });
    }
    
    else if (interaction.customId.startsWith('deny_')) {
        const userId = interaction.customId.replace('deny_', '');
        const modal = new ModalBuilder()
            .setCustomId(`deny_reason_${userId}`)
            .setTitle('❌ Причина отказа');
        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Причина отказа:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Напишите причину отказа...')
            .setRequired(true);
        const row = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row);
        await interaction.showModal(modal);
    }
    
    else if (interaction.customId.startsWith('ask_')) {
        const userId = interaction.customId.replace('ask_', '');
        const modal = new ModalBuilder()
            .setCustomId(`ask_question_${userId}`)
            .setTitle('💬 Уточнение по заявке');
        const questionInput = new TextInputBuilder()
            .setCustomId('question')
            .setLabel('Вопрос пользователю:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Что нужно уточнить?')
            .setRequired(true);
        const row = new ActionRowBuilder().addComponents(questionInput);
        modal.addComponents(row);
        await interaction.showModal(modal);
    }
});

// Обработка модалок (отказ и вопрос)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    
    if (interaction.customId.startsWith('deny_reason_')) {
        const userId = interaction.customId.replace('deny_reason_', '');
        const reason = interaction.fields.getTextInputValue('reason');
        try {
            const user = await client.users.fetch(userId);
            await user.send(`❌ **Ваша заявка отклонена**\n\nПричина: ${reason}\n\nЕсли у вас есть вопросы, свяжитесь с администрацией.`);
        } catch (e) {}
        await interaction.reply({ content: '❌ Заявка отклонена! Уведомление отправлено.', ephemeral: true });
        
        const originalMessage = interaction.message;
        if (originalMessage) {
            const embed = EmbedBuilder.from(originalMessage.embeds[0]).setColor(0xFF0000);
            await originalMessage.edit({ embeds: [embed], components: [] });
        }
    }
    
    else if (interaction.customId.startsWith('ask_question_')) {
        const userId = interaction.customId.replace('ask_question_', '');
        const question = interaction.fields.getTextInputValue('question');
        try {
            const user = await client.users.fetch(userId);
            await user.send(`💬 **Уточнение по вашей заявке**\n\n${question}\n\nПожалуйста, ответьте на это сообщение или свяжитесь с администрацией.`);
        } catch (e) {}
        await interaction.reply({ content: '💬 Вопрос отправлен пользователю!', ephemeral: true });
    }
});

client.login(TOKEN);

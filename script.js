// Инициализируем объект Telegram Web App
const tg = window.Telegram.WebApp;

// Настройки
const API_URL = 'https://your-username.github.io/your-repo-name/'; // ЗАМЕНИТЬ НА СВОЙ URL ПОСЛЕ ЗАГРУЗКИ
const CURRENCY = 'MDL';

// Состояние приложения
let currentScreen = 'loader';
let productHistory = []; // Для кнопки "назад"
let cart = {}; // { 'product_id_size_color': { item, qty } }

// --- Функции для взаимодействия с API Бота ---

// Общая функция для отправки запросов боту
function queryBot(data, callback) {
    tg.sendData(JSON.stringify(data));
    // Временный хак: aiogram не имеет прямого колбэка для answerWebAppQuery,
    // поэтому мы будем слушать событие viewportChanged, которое триггерится после ответа.
    // Это неидеально, но работает для простых случаев.
    // В будущем aiogram может добавить более надежный механизм.
    const listener = (event) => {
        if(event.isStateStable) {
            // Здесь мы не можем получить данные ответа напрямую.
            // Вместо этого бот должен будет отправить сообщение в чат
            // или мы должны будем получать данные через другой механизм.

            // ВАЖНОЕ ОБНОВЛЕНИЕ: Aiogram 3.x НЕ МОЖЕТ отправлять данные НАПРЯМУЮ в Web App
            // в ответ на sendData. Это ограничение Telegram Bot API.
            // Поэтому мы меняем логику: Web App запрашивает ВСЕ данные один раз при старте.
            console.warn("Получение данных в реальном времени через sendData не поддерживается. Загружаем все данные при старте.");
            tg.off('viewportChanged', listener);
        }
    };
    tg.on('viewportChanged', listener);
}

// Загрузка всех данных магазина при старте
async function fetchInitialData() {
    return new Promise((resolve, reject) => {
        const command = { command: 'get_all_data' };
        // Вместо прямого ответа, бот отправит данные в специальное сообщение.
        // Web App их прочитает. Для простоты, мы будем использовать tg.CloudStorage
        // Но для еще большей простоты, мы будем делать запрос к боту, который вернет данные
        // через answerWebAppQuery. Это поддерживается в aiogram 3.х!

        // Создаем специальный обработчик для ответа
        const handleResponse = (response) => {
            if (response.data) {
                try {
                    const data = JSON.parse(response.data);
                    resolve(data);
                } catch (e) {
                    reject('Ошибка парсинга данных от бота');
                }
            } else {
                 reject('Пустой ответ от бота');
            }
            tg.off('web_app_data_received', handleResponse);
        };
        tg.on('web_app_data_received', handleResponse);

        // Отправляем запрос
        tg.sendData(JSON.stringify(command));
    });
}


// --- Функции для отрисовки интерфейса ---

// Показать нужный "экран"
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    currentScreen = screenId;
    tg.BackButton.hide();
    if (screenId !== 'categories-screen') {
        tg.BackButton.show();
    }
}

// Отрисовка категорий
function renderCategories(categories) {
    const list = document.getElementById('categories-list');
    list.innerHTML = '';
    categories.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerText = cat.name;
        item.onclick = () => fetchProducts(cat.id, cat.name);
        list.appendChild(item);
    });
}

// Отрисовка товаров
function renderProducts(products, categoryName) {
    document.getElementById('category-title').innerText = categoryName;
    const grid = document.getElementById('products-list');
    grid.innerHTML = '';
    if (products.length === 0) {
        grid.innerHTML = '<p>В этой категории пока нет товаров.</p>';
    } else {
        products.forEach(p => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <img src="${p.photo}" alt="${p.name}">
                <div class="product-card-info">
                    <h3>${p.name}</h3>
                    <p>${(p.price / 100).toFixed(2)} ${CURRENCY}</p>
                </div>
            `;
            card.onclick = () => showProductDetails(p.id);
            grid.appendChild(card);
        });
    }
    showScreen('products-screen');
    productHistory.push({ type: 'category', id: products.length > 0 ? products[0].category_id : null });
}

// Отрисовка деталей товара
function renderProductDetails(product) {
    const content = document.getElementById('product-details-content');

    const sizes = product.sizes.split(',').filter(s => s);
    const colors = product.colors.split(',').filter(c => c);

    let sizesHtml = '';
    if (sizes.length > 0) {
        sizesHtml = `<div class="options-group"><h4>Размер:</h4>${sizes.map(s => `<span class="option-button" data-type="size" data-value="${s}">${s}</span>`).join('')}</div>`;
    }

    let colorsHtml = '';
    if (colors.length > 0) {
        colorsHtml = `<div class="options-group"><h4>Цвет:</h4>${colors.map(c => `<span class="option-button" data-type="color" data-value="${c}">${c}</span>`).join('')}</div>`;
    }

    content.innerHTML = `
        <img src="${product.photo}" alt="${product.name}">
        <h2>${product.name}</h2>
        <p><strong>${(product.price / 100).toFixed(2)} ${CURRENCY}</strong></p>
        <p>${product.description}</p>
        ${sizesHtml}
        ${colorsHtml}
        <button id="add-to-cart-btn" class="action-button" onclick='addToCart(${product.id})'>Добавить в корзину</button>
    `;

    document.querySelectorAll('.option-button').forEach(btn => {
        btn.onclick = (e) => {
            const type = e.target.dataset.type;
            document.querySelectorAll(`.option-button[data-type=${type}]`).forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
        };
    });
    showScreen('product-details-screen');
    productHistory.push({ type: 'product', id: product.id, category_id: product.category_id });
}


// --- Функции для навигации ---
function goBackToProducts() {
    const lastState = productHistory.pop();
    const category = window.shopData.categories.find(c => c.id === lastState.category_id);
    fetchProducts(lastState.category_id, category ? category.name : 'Товары');
}

function goBackFromCart() {
    if (productHistory.length === 0) {
        fetchCategories();
    } else {
        const lastState = productHistory[productHistory.length - 1];
        if(lastState.type === 'category') {
             const category = window.shopData.categories.find(c => c.id === lastState.id);
             fetchProducts(lastState.id, category ? category.name : 'Товары');
        } else if (lastState.type === 'product') {
            showProductDetails(lastState.id);
        }
    }
}


// --- Функции-контроллеры (запрос данных и вызов отрисовки) ---

function fetchCategories() {
    renderCategories(window.shopData.categories);
    showScreen('categories-screen');
}

function fetchProducts(categoryId, categoryName) {
    const products = window.shopData.products.filter(p => p.category_id === categoryId);
    renderProducts(products, categoryName);
}

function showProductDetails(productId) {
    const product = window.shopData.products.find(p => p.id === productId);
    renderProductDetails(product);
}


// --- Логика корзины ---

function addToCart(productId) {
    const product = window.shopData.products.find(p => p.id === productId);
    const selectedSizeEl = document.querySelector('.option-button[data-type="size"].selected');
    const selectedColorEl = document.querySelector('.option-button[data-type="color"].selected');

    // Проверка, выбраны ли опции, если они есть
    if (product.sizes && !selectedSizeEl) {
        tg.showAlert('Пожалуйста, выберите размер');
        return;
    }
    if (product.colors && !selectedColorEl) {
        tg.showAlert('Пожалуйста, выберите цвет');
        return;
    }

    const size = selectedSizeEl ? selectedSizeEl.dataset.value : '--';
    const color = selectedColorEl ? selectedColorEl.dataset.value : '--';

    const cartKey = `${productId}_${size}_${color}`;

    if (cart[cartKey]) {
        cart[cartKey].qty += 1;
    } else {
        cart[cartKey] = {
            item: {
                id: product.id,
                name: product.name,
                price: product.price,
                size: size,
                color: color
            },
            qty: 1
        };
    }

    tg.HapticFeedback.notificationOccurred('success');
    updateCartCounter();
    tg.showAlert(`${product.name} добавлен в корзину!`);
}

function updateCartCounter() {
    const counter = document.getElementById('cart-counter');
    const totalItems = Object.values(cart).reduce((sum, entry) => sum + entry.qty, 0);
    if (totalItems > 0) {
        counter.innerText = totalItems;
        counter.style.display = 'inline-block';
    } else {
        counter.style.display = 'none';
    }
}

function showCart() {
    const itemsContainer = document.getElementById('cart-items');
    const totalContainer = document.getElementById('cart-total');
    const actionsContainer = document.getElementById('cart-actions');
    itemsContainer.innerHTML = '';
    actionsContainer.innerHTML = '';

    let totalAmount = 0;
    const cartItems = Object.values(cart);

    if (cartItems.length === 0) {
        itemsContainer.innerHTML = '<p>Корзина пуста.</p>';
        totalContainer.innerText = '';
        tg.MainButton.hide();
    } else {
        cartItems.forEach(entry => {
            const cartKey = `${entry.item.id}_${entry.item.size}_${entry.item.color}`;
            const itemEl = document.createElement('div');
            itemEl.className = 'cart-item';
            itemEl.innerHTML = `
                <div class="cart-item-info">
                    <strong>${entry.item.name}</strong><br>
                    <small>${entry.item.size}, ${entry.item.color}</small>
                </div>
                <div>${entry.qty} x ${(entry.item.price / 100).toFixed(2)}</div>
                <div class="cart-item-remove" onclick="removeFromCart('${cartKey}')"> 🗑️ </div>
            `;
            itemsContainer.appendChild(itemEl);
            totalAmount += entry.item.price * entry.qty;
        });

        totalContainer.innerText = `Итого: ${(totalAmount / 100).toFixed(2)} ${CURRENCY}`;

        // Показываем главную кнопку Telegram для оплаты
        tg.MainButton.setText(`Оплатить ${(totalAmount / 100).toFixed(2)} ${CURRENCY}`);
        tg.MainButton.show();
    }

    showScreen('cart-screen');
}

function removeFromCart(cartKey) {
    if (cart[cartKey]) {
        delete cart[cartKey];
        showCart(); // Перерисовать корзину
        updateCartCounter();
    }
}


// --- Инициализация и обработчики событий Telegram ---

// Инициализация при загрузке
window.addEventListener('load', async () => {
    tg.ready();
    tg.expand();

    try {
        // Устаревший подход с получением данных через answerWebAppQuery
        // Мы будем использовать другой, более надёжный
        // window.shopData = await fetchInitialData();

        // Новый, более простой подход: бот отправит данные сам
    } catch(e) {
        console.error(e);
        document.getElementById('loader').innerText = 'Не удалось загрузить магазин. Попробуйте позже.';
        return;
    }

    // ВМЕСТО ЭТОГО МЫ СДЕЛАЕМ ТАК:
    // Мы отправим запрос, а бот ответит через answerWebAppQuery
    // и данные придут в событие web_app_data_received
    tg.on('web_app_data_received', (data) => {
        try {
            const payload = JSON.parse(data.data);
            if (payload.type === 'all_data') {
                window.shopData = payload.data;
                renderCategories(window.shopData.categories);
                showScreen('categories-screen');
            } else if (payload.type === 'payment_url') {
                // Если бот присылает ссылку на оплату
                tg.openInvoice(payload.url, (status) => {
                    if (status === 'paid') {
                        cart = {}; // Очищаем корзину
                        updateCartCounter();
                        tg.close(); // Закрываем Web App
                    }
                });
            }
        } catch (e) {
            console.error('Ошибка обработки данных от бота:', e);
        }
    });

    // Запрашиваем все данные при старте
    tg.sendData(JSON.stringify({ command: 'get_all_data' }));

    // Обработчик главной кнопки "Оплатить"
    tg.on('mainButtonClicked', () => {
        const orderData = {
            command: 'create_order',
            cart: cart
        };
        tg.sendData(JSON.stringify(orderData));
    });

    // Обработчик кнопки "Назад"
    tg.on('backButtonClicked', () => {
        if (currentScreen === 'products-screen') {
            fetchCategories();
        } else if (currentScreen === 'product-details-screen') {
            goBackToProducts();
        } else if (currentScreen === 'cart-screen') {
            goBackFromCart();
        }
    });
});
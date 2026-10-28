# ExamAI Pro: 8 EUR месечно

Pro е личен учителски абонамент с автоматично месечно подновяване. Нови годишни абонаменти не се предлагат. Учениците използват приложението безплатно. Формата за карта, Apple Pay и Google Pay се предоставят от хоствания Stripe Checkout; ExamAI не получава номер на карта или CVC.

Интеграцията използва стандартен Stripe Checkout и изпраща изрично `managed_payments[enabled]=false`. Някои нови Stripe акаунти включват Managed Payments по подразбиране; това е отделен merchant-of-record продукт, който изисква допустим продуктов данъчен код и не е част от текущата интеграция.

Кодът сам по себе си не активира реални плащания. Нужни са продукт, платежни методи, webhook и backend променливи в съответната Stripe/Railway среда.

## Получаване на приходите

Railway хоства приложението. Stripe приема плащанията на клиентите и изплаща приходите към добавената банкова сметка. Създайте или влезте в своя Stripe акаунт, завършете активацията и изискваната проверка на данните за дейността и представителя. Добавете банковата сметка в [Stripe Payout settings](https://dashboard.stripe.com/settings/money-management); за българска банкова сметка се използва IBAN. IBAN не се добавя в Railway или в кода на ExamAI.

## Stripe

1. Създайте продукт **ExamAI Pro** с една фиксирана recurring цена **8.00 EUR**, интервал **month**, interval count **1**, количество **1**. Копирайте нейния `price_...` идентификатор. Backend проверява сумата от 800 евроцента, валутата и месечния период, преди да създаде Checkout.
2. В [Payment methods](https://dashboard.stripe.com/settings/payment_methods) активирайте **Cards**, **Apple Pay** и **Google Pay** за съответната среда. Checkout избира съвместимите методи динамично; wallet бутоните зависят и от държавата, устройството, браузъра и настроения портфейл. За Stripe-hosted Checkout не е необходимо добавяне на Apple Pay verification файл в ExamAI.
3. Включете [Customer Portal](https://dashboard.stripe.com/settings/billing/portal) за промяна на платежния метод и преглед на фактури. Ако разрешите прекратяване и в Portal, изберете **at period end**. Изключете смяна на продукт, произволно количество и годишни предложения.
4. Създайте webhook event destination за **Your account**, формат **Snapshot**, на адрес `https://javatest-production-245b.up.railway.app/api/v1/billing/webhook`. Използвайте API версията на `com.stripe.Stripe.API_VERSION` от включения Stripe SDK. Разрешете:

```text
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

## Railway: само backend Variables

```dotenv
STRIPE_MODE=live
STRIPE_SECRET_KEY=<live secret key от Stripe>
STRIPE_WEBHOOK_SECRET=<подписващата тайна на live webhook endpoint-а>
STRIPE_PRO_MONTH_PRICE_ID=<live price ID за 8 EUR месечно>
FRONTEND_URL=https://frontend-production-8dc0.up.railway.app
BACKEND_URL=https://javatest-production-245b.up.railway.app
BILLING_FIXTURES=false
BILLING_FREE_AI_CREDITS=10
```

Приложете Variables с deployment. Ключовете се въвеждат директно в Railway, а не в чат, Git или `VITE_*` променливи. За тестовата среда използвайте `STRIPE_MODE=test` и съответните test ключ, цена и webhook; не смесвайте test и live обекти или бази.

`STRIPE_PRO_YEAR_PRICE_ID` вече не е необходим за нови покупки. Оставете го само ако базата съдържа съществуващи годишни абонаменти, чиито webhooks трябва да продължат да се проверяват. Съществуващи абонаменти не се преценяват или прехвърлят към друга цена автоматично.

## Спиране на подновяването

В **Профил → План и плащане** учителят избира **Спри подновяването** и потвърждава. Няма отделен навигационен таб за абонамента. Старите Stripe адреси `/billing?checkout=success` и `/billing?checkout=canceled` отварят профила и запазват потвърждението на плащането. `POST /api/v1/billing/cancel` не приема customer или subscription от браузъра. Услугата заключва платежния профил на текущия учител, проверява връзката с Stripe и задава само `cancel_at_period_end=true`.

Отговорът от Stripe се проверява преди локално потвърждение и одит. Платеният срок не се удължава или съкращава; Pro остава до неговия край, след което се прилагат Free лимитите. Повторна заявка е безопасна. Неуспешен отговор не показва абонамента като прекратен.

## Проверка

В тестовата среда завършете Checkout от учителски профил, потвърдете доставен `invoice.paid`, после презаредете приложението. URL `checkout=success` сам по себе си не активира Pro. Проверете ръчно въвеждане на тестова карта, Google Pay и Apple Pay на съвместими устройства, месечно подновяване, отказана фактура и спиране до края на платения период. Локалните автоматизирани тестове използват фиктивни API отговори и не доказват работещо live начисляване.

Официални ръководства: [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [Apple Pay](https://docs.stripe.com/apple-pay), [Google Pay](https://docs.stripe.com/google-pay), [Cancel at period end](https://docs.stripe.com/billing/subscriptions/cancel).

## Отказ за липсващ продуктов данъчен код

Ако стар Checkout опит е върнал `the product tax code is missing` за Managed Payments, повторение със същия Stripe idempotency key може да връща записания отказ. След обновяване приложението първо проверява старите параметри: успешна стара сесия се използва отново. Само след потвърждение на конкретния Managed Payments отказ се използва отделен, постоянен ключ за стандартния Checkout. При timeout или друг непознат отказ не се създава нов ключ. Не е необходимо да се изтриват платежни записи или да се сменят API ключовете.

## Административно управление

В **Администрация → Абонаменти** се виждат използваните групи, активни възлагания и AI кредити спрямо лимита. Филтрите по име, имейл и план могат да се комбинират.

**Смени плана** задава административен Free/Pro достъп до следваща административна промяна. **Автоматичен — според Stripe** премахва тази настройка и възстановява достъпа според платения период. Това не създава, отменя или променя таксуване в Stripe; съществуващият абонамент се управлява от профила на учителя. Профилът показва кога достъпът е зададен от администратор.

**Нулирай AI** възстановява само използваните кредити за избран календарен месец или пробния период. Запазва текущите резервирани операции, групите, възлаганията и историята. Промените се записват в административния журнал; повторна заявка със същия ключ не извършва действието повторно.

-- Shared catalog, maintained by platform administrators. Seeds are inserted once, then editable.
CREATE TABLE subject_catalog_mutex (id INT PRIMARY KEY);
INSERT INTO subject_catalog_mutex(id) VALUES(1);

CREATE TABLE subject_catalog (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(190) NOT NULL,
    normalized_name VARCHAR(190) NOT NULL UNIQUE,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL
);

CREATE TABLE subject_topics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    subject_id BIGINT NOT NULL,
    name VARCHAR(190) NOT NULL,
    normalized_name VARCHAR(190) NOT NULL,
    level VARCHAR(2) NOT NULL DEFAULT '',
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE (subject_id, normalized_name, level),
    FOREIGN KEY (subject_id) REFERENCES subject_catalog(id) ON DELETE CASCADE
);

INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Български език и литература','български език и литература',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Правопис','правопис','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='български език и литература';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Части на речта','части на речта','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='български език и литература';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Изречение','изречение','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='български език и литература';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Литературни произведения','литературни произведения','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='български език и литература';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Математика','математика',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Естествени числа','естествени числа','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='математика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Дроби','дроби','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='математика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Проценти','проценти','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='математика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Уравнения','уравнения','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='математика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Геометрични фигури','геометрични фигури','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='математика';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Английски език','английски език',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Граматика','граматика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='английски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Лексика','лексика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='английски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Четене с разбиране','четене с разбиране','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='английски език';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Немски език','немски език',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Граматика','граматика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='немски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Лексика','лексика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='немски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Четене с разбиране','четене с разбиране','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='немски език';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Френски език','френски език',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Граматика','граматика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='френски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Лексика','лексика','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='френски език';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Четене с разбиране','четене с разбиране','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='френски език';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('История и цивилизации','история и цивилизации',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Древни цивилизации','древни цивилизации','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='история и цивилизации';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Средновековие','средновековие','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='история и цивилизации';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Българска история','българска история','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='история и цивилизации';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('География и икономика','география и икономика',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Климат','климат','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='география и икономика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Води','води','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='география и икономика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Почви','почви','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='география и икономика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Население','население','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='география и икономика';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Биология и здравно образование','биология и здравно образование',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Клетка','клетка','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='биология и здравно образование';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Човешко тяло','човешко тяло','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='биология и здравно образование';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Екосистеми','екосистеми','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='биология и здравно образование';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Физика и астрономия','физика и астрономия',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Движение и сили','движение и сили','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='физика и астрономия';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Електричество','електричество','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='физика и астрономия';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Топлина','топлина','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='физика и астрономия';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Химия и опазване на околната среда','химия и опазване на околната среда',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Атоми и молекули','атоми и молекули','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='химия и опазване на околната среда';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Химични реакции','химични реакции','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='химия и опазване на околната среда';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Вещества','вещества','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='химия и опазване на околната среда';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Информатика','информатика',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Алгоритми','алгоритми','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информатика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Променливи и типове данни','променливи и типове данни','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информатика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Условни конструкции','условни конструкции','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информатика';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Цикли','цикли','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информатика';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Информационни технологии','информационни технологии',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Работа с текст','работа с текст','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информационни технологии';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Електронни таблици','електронни таблици','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информационни технологии';
INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) SELECT id,'Интернет и безопасност','интернет и безопасност','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM subject_catalog WHERE normalized_name='информационни технологии';
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Философия','философия',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Музика','музика',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Изобразително изкуство','изобразително изкуство',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Технологии и предприемачество','технологии и предприемачество',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES('Физическо възпитание и спорт','физическо възпитание и спорт',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

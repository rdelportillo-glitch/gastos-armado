-- ============================================================================
-- DATOS MAESTROS DE DEMOSTRACIÓN (no dependen de usuarios de auth)
-- Categorías, subcategorías, productos, técnicos, activos y tipos de herramienta.
-- ============================================================================

insert into public.categories (id, name, active) values
  ('cffe354e-ab20-51c1-96d4-36d5634728b9', 'Insumos', true),
  ('74cc6120-6e35-59ce-98a1-5c79f532a586', 'Herramientas', true),
  ('75295aab-d265-5c67-8a6a-c137cab03620', 'Comunicaciones', true),
  ('09d31b32-2cab-56c1-9270-403535c3caa9', 'Dotación y EPP', true),
  ('b3528571-5210-5147-827f-bc609ff31573', 'Transporte y movilidad', true),
  ('e0d2a610-fc10-5e0e-a0a9-582d42a4e078', 'Gastos operativos', true),
  ('c1e053f3-d969-5065-aca3-d4b1a835f61b', 'Capacitación', true),
  ('72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Beneficios empleados', true);

insert into public.subcategories (id, category_id, name, tipo, track_stock, active) values
  ('7af8458b-4bad-5f89-ae30-a4fa1b748c52', 'cffe354e-ab20-51c1-96d4-36d5634728b9', 'Vinipel', 'consumible', true, true),
  ('9c85c438-1041-5409-ab54-6c6ec4f02f94', 'cffe354e-ab20-51c1-96d4-36d5634728b9', 'Cinta', 'consumible', false, true),
  ('8a292139-3982-5269-b6bc-019c6d7f5f7c', 'cffe354e-ab20-51c1-96d4-36d5634728b9', 'Tornillería', 'consumible', false, true),
  ('227df704-a41f-59dc-b057-03cfabb234ed', 'cffe354e-ab20-51c1-96d4-36d5634728b9', 'Brocas', 'consumible', false, true),
  ('0b39623d-d5c1-5843-861d-7038ff52e38e', 'cffe354e-ab20-51c1-96d4-36d5634728b9', 'Silicona', 'consumible', false, true),
  ('ea1e9a5f-a7b1-5f3c-988e-1312f3b68519', '74cc6120-6e35-59ce-98a1-5c79f532a586', 'Taladro inalámbrico', 'activo', false, true),
  ('b3ad461e-9fe8-5b6b-8ccb-7dabaed9417c', '74cc6120-6e35-59ce-98a1-5c79f532a586', 'Taladro percutor', 'activo', false, true),
  ('a069e845-d527-5669-a7e0-3556bf3378e6', '74cc6120-6e35-59ce-98a1-5c79f532a586', 'Atornillador', 'activo', false, true),
  ('c9a33156-af78-589d-a523-7cd3839e3b2b', '74cc6120-6e35-59ce-98a1-5c79f532a586', 'Caja de herramientas', 'activo', false, true),
  ('4349e675-82f3-5020-809f-3f9363dcc4a2', '74cc6120-6e35-59ce-98a1-5c79f532a586', 'Juego de llaves', 'activo', false, true),
  ('ecb1e9b8-62ec-51a8-893a-e414b4cceba1', '75295aab-d265-5c67-8a6a-c137cab03620', 'Auxilio plan de datos', 'gasto', false, true),
  ('94b4ac24-b41b-5984-b2dc-e1865fa90ab9', '75295aab-d265-5c67-8a6a-c137cab03620', 'Recarga celular', 'consumible', false, true),
  ('b9010024-5c84-5bca-8f9f-cfa0600b1fcf', '75295aab-d265-5c67-8a6a-c137cab03620', 'SIM', 'consumible', false, true),
  ('7606e89f-cd99-5b43-943c-617010c6476a', '75295aab-d265-5c67-8a6a-c137cab03620', 'Reposición de celular', 'activo', false, true),
  ('be81d34f-2055-5a97-98bb-b5d94bd698b0', '09d31b32-2cab-56c1-9270-403535c3caa9', 'Camisa', 'consumible', false, true),
  ('b8881d48-3c11-5a3a-a824-9914a659f4e7', '09d31b32-2cab-56c1-9270-403535c3caa9', 'Botas', 'consumible', false, true),
  ('fdc46f2a-3fa2-5cc0-ba31-e5d08ca839be', '09d31b32-2cab-56c1-9270-403535c3caa9', 'Guantes', 'consumible', false, true),
  ('c2ae0305-0e0c-5b95-94ce-9b944c21c29b', '09d31b32-2cab-56c1-9270-403535c3caa9', 'Gafas de protección', 'consumible', false, true),
  ('8edb54ba-66db-5add-be42-abf45b75d843', 'b3528571-5210-5147-827f-bc609ff31573', 'Auxilio transporte', 'gasto', false, true),
  ('e19ced28-4ce3-5bd6-9169-2b9f02947300', 'b3528571-5210-5147-827f-bc609ff31573', 'Taxi', 'gasto', false, true),
  ('938ca9fa-d5bd-590a-974b-40070d98756a', 'b3528571-5210-5147-827f-bc609ff31573', 'Combustible', 'gasto', false, true),
  ('f2663df8-2538-5b76-b8ba-3240b3eec125', 'b3528571-5210-5147-827f-bc609ff31573', 'Peajes', 'gasto', false, true),
  ('ae1d94fc-bf47-5a9f-ac32-da706562de55', 'e0d2a610-fc10-5e0e-a0a9-582d42a4e078', 'Alimentación', 'gasto', false, true),
  ('4f766d72-c95f-557b-aabb-e76911d55840', 'e0d2a610-fc10-5e0e-a0a9-582d42a4e078', 'Hospedaje', 'gasto', false, true),
  ('7056f2b8-aa78-5913-8047-3799fb68176b', 'e0d2a610-fc10-5e0e-a0a9-582d42a4e078', 'Viáticos', 'gasto', false, true),
  ('a4d9e54a-96b2-58d4-9c3e-d97930e32fc9', 'c1e053f3-d969-5065-aca3-d4b1a835f61b', 'Capacitación técnica', 'gasto', false, true),
  ('6fd7b154-a78c-59e8-b6f6-2bb55b0f545b', 'c1e053f3-d969-5065-aca3-d4b1a835f61b', 'Certificación', 'gasto', false, true),
  ('348dcbb7-7a1e-5b42-82a5-cc4f0ad089fb', '72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Bono de cumpleaños', 'gasto', false, true),
  ('3ae40a6c-92b7-5989-a256-802f79c8b0f5', '72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Casino', 'gasto', false, true),
  ('569c0910-df5c-54b1-8f15-9cda2046c1ac', '72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Cafetería', 'gasto', false, true),
  ('339cfb93-edeb-57b6-81ba-b35a74d3aeaa', '72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Eventos', 'gasto', false, true),
  ('445f56ea-5607-5c4e-95d6-1b95fc5cd1b3', '72941922-f8df-5b72-ab06-b2d4af46fe1e', 'Celebraciones', 'gasto', false, true);

insert into public.products (id, subcategory_id, name, active) values
  ('ee7f8615-15a2-58b7-a0dc-2bede151e148', '7af8458b-4bad-5f89-ae30-a4fa1b748c52', 'Rollo Vinipel 300m', true),
  ('c44e828d-df0b-5c45-b5e2-ee4c8257b853', '9c85c438-1041-5409-ab54-6c6ec4f02f94', 'Cinta de embalaje 48mm', true),
  ('e9fd3718-3269-5b6b-b1b8-2d98b03dd9e1', '8a292139-3982-5269-b6bc-019c6d7f5f7c', 'Kit tornillería mixta', true),
  ('f61a27f0-85e2-5a70-a6f6-94c0fbf0dc0f', '227df704-a41f-59dc-b057-03cfabb234ed', 'Juego brocas 5-10mm', true),
  ('6704c097-20ec-53a6-b330-5a987ee334de', '0b39623d-d5c1-5843-861d-7038ff52e38e', 'Silicona transparente 300ml', true),
  ('73f7253d-4b23-5641-aeb4-4fc55535a36b', 'ea1e9a5f-a7b1-5f3c-988e-1312f3b68519', 'Taladro inalámbrico Bosch 18V', true),
  ('67cc2ba5-827f-5223-8113-2d030c06a28c', 'b3ad461e-9fe8-5b6b-8ccb-7dabaed9417c', 'Taladro percutor DeWalt 20V', true),
  ('3d956938-d979-55f5-ade6-3bace5e1d910', 'a069e845-d527-5669-a7e0-3556bf3378e6', 'Atornillador eléctrico Makita', true),
  ('0df1c3c0-c02e-56a5-aa62-7458b6ee904a', 'c9a33156-af78-589d-a523-7cd3839e3b2b', 'Caja de herramientas Stanley', true),
  ('8f6e7ca3-c66d-52e6-8ebd-c7e69dbed07b', '4349e675-82f3-5020-809f-3f9363dcc4a2', 'Juego de llaves combinadas', true),
  ('227f3d3c-f1e1-5bd4-a737-2a0eb288bc41', 'ecb1e9b8-62ec-51a8-893a-e414b4cceba1', 'Plan de datos mensual', true),
  ('f85b71fb-d259-5dc1-beb2-f23d618d3bca', '94b4ac24-b41b-5984-b2dc-e1865fa90ab9', 'Recarga Claro/Movistar', true),
  ('106b5e44-10a0-5d9a-9cb3-cca2c7aa6e8c', 'b9010024-5c84-5bca-8f9f-cfa0600b1fcf', 'SIM prepago', true),
  ('98144596-7476-586d-b840-61a8837ca173', '7606e89f-cd99-5b43-943c-617010c6476a', 'Celular gama media', true),
  ('86f32566-d6eb-5e39-9ffb-631ad2fe2ffc', 'be81d34f-2055-5a97-98bb-b5d94bd698b0', 'Camisa dotación M/L/XL', true),
  ('edb0bd93-804b-5aa7-950b-e3fea22fdf60', 'b8881d48-3c11-5a3a-a824-9914a659f4e7', 'Botas de seguridad', true),
  ('314ffe9a-23d3-5c6e-bb4f-b9416bb1cc31', 'fdc46f2a-3fa2-5cc0-ba31-e5d08ca839be', 'Guantes de carnaza', true),
  ('6d44e8f6-454b-58ee-a43f-e29dc75cdda7', 'c2ae0305-0e0c-5b95-94ce-9b944c21c29b', 'Gafas de protección claras', true),
  ('f4eb23fe-49f4-58b8-afc1-c23a015a925b', '938ca9fa-d5bd-590a-974b-40070d98756a', 'Galón de combustible', true),
  ('caed7ca0-da5f-5f64-8077-7dbd27a74df8', 'ae1d94fc-bf47-5a9f-ac32-da706562de55', 'Almuerzo operativo', true);

insert into public.technicians (id, code, name, document, phone, city, department, zone, entry_date, status, exit_date, type, notes) values
  ('8f8413e4-543c-5069-9e6a-0c95de00fcb5', 'TEC-01', 'Carlos Andrés Pérez', '10000000', '300000000', 'Barranquilla', 'Atlántico', 'Norte', '2023-01-05', 'Activo', NULL, 'Instalador', NULL),
  ('a479912a-d868-554f-95cc-f982c3044dda', 'TEC-02', 'Juan David Martínez', '10037421', '300070000', 'Cartagena', 'Bolívar', 'Sur', '2023-02-06', 'Activo', NULL, 'Técnico senior', NULL),
  ('b12d0fb3-4f6d-5d83-9196-3f43851b407f', 'TEC-03', 'Luis Fernando Gómez', '10074842', '300140000', 'Santa Marta', 'Magdalena', 'Centro', '2023-03-07', 'Activo', NULL, 'Técnico junior', NULL),
  ('daa12a4c-25d8-5994-a17f-f5caacfbb53c', 'TEC-04', 'Andrés Felipe Torres', '10112263', '300210000', 'Bogotá', 'Bogotá D.C.', 'Costa', '2023-04-08', 'Activo', NULL, 'Supervisor de campo', NULL),
  ('a0375dd1-8858-55f8-88ec-2fe934687a98', 'TEC-05', 'Jorge Iván Ramírez', '10149684', '300280000', 'Medellín', 'Antioquia', 'Oriente', '2023-05-09', 'Activo', NULL, 'Instalador', NULL),
  ('14734224-7245-5064-8cdc-a41ec7f1befa', 'TEC-06', 'Miguel Ángel Rodríguez', '10187105', '300350000', 'Cali', 'Valle del Cauca', 'Norte', '2023-06-10', 'Activo', NULL, 'Técnico senior', NULL),
  ('c4c49361-85ca-571f-9fab-0399c459b397', 'TEC-07', 'Sergio Alexander Díaz', '10224526', '300420000', 'Bucaramanga', 'Santander', 'Sur', '2023-07-11', 'Activo', NULL, 'Técnico junior', NULL),
  ('12ac3603-976d-564d-a612-391fd5754f90', 'TEC-08', 'Camilo Ernesto Vargas', '10261947', '300490000', 'Montería', 'Córdoba', 'Centro', '2023-08-12', 'Activo', NULL, 'Supervisor de campo', NULL),
  ('55b624b5-9198-500a-9dcb-799c80e73b11', 'TEC-09', 'Daniel Esteban Castro', '10299368', '300560000', 'Barranquilla', 'Atlántico', 'Costa', '2023-09-13', 'Activo', NULL, 'Instalador', NULL),
  ('e86f32bd-6a9d-5d51-a3a0-32de6a23e3d5', 'TEC-10', 'Fabián Orlando Mendoza', '10336789', '300630000', 'Cartagena', 'Bolívar', 'Oriente', '2023-10-14', 'Activo', NULL, 'Técnico senior', NULL),
  ('aa083546-3d56-55be-ba8d-f1919a6992a9', 'TEC-11', 'Ricardo José Salazar', '10374210', '300700000', 'Santa Marta', 'Magdalena', 'Norte', '2023-11-15', 'Activo', NULL, 'Técnico junior', NULL),
  ('34c39b93-79b7-56ab-9652-524ad6456094', 'TEC-12', 'Alexander Duarte Pacheco', '10411631', '300770000', 'Bogotá', 'Bogotá D.C.', 'Sur', '2023-12-16', 'Activo', NULL, 'Supervisor de campo', NULL),
  ('22aee5d2-fc49-5aee-a2cd-684720a71a01', 'TEC-13', 'Wilmer Steven Beltrán', '10449052', '300840000', 'Medellín', 'Antioquia', 'Centro', '2023-01-17', 'Activo', NULL, 'Instalador', NULL),
  ('6c6e2cbb-d4c4-5041-915a-8dc35a1b5f54', 'TEC-14', 'Édgar Julián Rojas', '10486473', '300910000', 'Cali', 'Valle del Cauca', 'Costa', '2023-02-18', 'Activo', NULL, 'Técnico senior', NULL),
  ('918bd7fd-c479-5212-9f33-6ee60b27156a', 'TEC-15', 'Yeison Camilo Cárdenas', '10523894', '300980000', 'Bucaramanga', 'Santander', 'Oriente', '2023-03-19', 'Activo', NULL, 'Técnico junior', NULL),
  ('d1513e57-266f-5c3d-97ea-e2b128b0e383', 'TEC-16', 'Néstor Iván Suárez', '10561315', '300050000', 'Montería', 'Córdoba', 'Norte', '2023-04-20', 'Activo', NULL, 'Supervisor de campo', NULL),
  ('ebeb4d24-f83c-5418-bfac-feba7dd0d62b', 'TEC-17', 'Harold Andrés Peña', '10598736', '300120000', 'Barranquilla', 'Atlántico', 'Sur', '2023-05-21', 'Activo', NULL, 'Instalador', NULL),
  ('92dceb70-1bf8-5f09-b739-66331c301561', 'TEC-18', 'Kevin Santiago Molina', '10636157', '300190000', 'Cartagena', 'Bolívar', 'Centro', '2023-06-22', 'Inactivo', NULL, 'Técnico senior', NULL),
  ('0a6d2eab-5129-5a62-8699-440bf2ee2309', 'TEC-19', 'Óscar Iván Guerra', '10673578', '300260000', 'Santa Marta', 'Magdalena', 'Costa', '2023-07-23', 'Retirado', '2026-06-15', 'Técnico junior', NULL),
  ('975ee120-972c-553b-9396-243d0f144c7a', 'TEC-20', 'Brayan Estiven Cuello', '10710999', '300330000', 'Bogotá', 'Bogotá D.C.', 'Oriente', '2023-08-24', 'Retirado', '2026-06-15', 'Supervisor de campo', NULL);

insert into public.asset_types (id, name, active) values
  ('d72e86d1-7eaa-54f2-a7b1-98d05268ef80', 'Taladro inalámbrico', true),
  ('21ccefa5-154b-5ba7-a770-072bf8276e93', 'Taladro percutor', true),
  ('780c7864-734a-5108-9159-b0fad7a801d4', 'Atornillador', true),
  ('0c3175d0-f938-5266-b3e6-60be714d2579', 'Caja de herramientas', true),
  ('6b1648ca-75d4-5d42-893b-57d0031c2d5f', 'Juego de llaves', true),
  ('45fedfbb-02ec-5469-8021-c88470aeb18d', 'Celular', true);

insert into public.assets (id, code, type, brand, model, serial, value, purchase_date, technician_id, delivery_date, status) values
  ('a6843bfd-9bdd-5271-a584-bd22e038b539', 'HER-01', 'Taladro inalámbrico', 'Bosch', 'M-1000', 'SN-100000', 200000, '2024-01-10', '8f8413e4-543c-5069-9e6a-0c95de00fcb5', '2024-11-05', 'Asignado'),
  ('f06b497a-1900-510d-aebe-f9a689550a37', 'HER-02', 'Taladro percutor', 'DeWalt', 'M-1001', 'SN-100091', 245000, '2024-02-10', 'a479912a-d868-554f-95cc-f982c3044dda', '2024-11-05', 'Asignado'),
  ('dfe6f3e8-7aa2-5366-91e1-943154071bca', 'HER-03', 'Atornillador', 'Makita', 'M-1002', 'SN-100182', 290000, '2024-03-10', 'b12d0fb3-4f6d-5d83-9196-3f43851b407f', '2024-11-05', 'Asignado'),
  ('e93a8ed7-07be-5ee4-97fe-2f3c93c40bdd', 'HER-04', 'Caja de herramientas', 'Stanley', 'M-1003', 'SN-100273', 335000, '2024-04-10', 'daa12a4c-25d8-5994-a17f-f5caacfbb53c', '2024-11-05', 'Asignado'),
  ('455a18e7-2834-51a7-bac0-fc87f6311bbd', 'HER-05', 'Juego de llaves', 'Truper', 'M-1004', 'SN-100364', 380000, '2024-05-10', 'a0375dd1-8858-55f8-88ec-2fe934687a98', '2024-11-05', 'Asignado'),
  ('9c2b8b12-4e05-5c73-965d-de9cda83114c', 'HER-06', 'Taladro inalámbrico', 'Bosch', 'M-1005', 'SN-100455', 425000, '2024-06-10', NULL, NULL, 'Disponible'),
  ('e0848393-071b-5283-85f0-c9775fd39bc6', 'HER-07', 'Taladro percutor', 'DeWalt', 'M-1006', 'SN-100546', 470000, '2024-07-10', NULL, NULL, 'En reparación'),
  ('30b65172-ed51-526e-9f22-8970c3756502', 'HER-08', 'Atornillador', 'Makita', 'M-1007', 'SN-100637', 515000, '2024-08-10', NULL, NULL, 'Dañado'),
  ('d42fe32c-015d-583f-908c-69e3a72b1337', 'HER-09', 'Taladro inalámbrico', 'Bosch', 'M-2099', 'SN-990099', 480000, '2023-05-01', '0a6d2eab-5129-5a62-8699-440bf2ee2309', '2023-05-10', 'Asignado');

insert into public.asset_assignments (id, asset_id, technician_id, from_date, to_date, assigned_by) values
  ('d783574d-f234-50ed-af46-cad0be7d11b6', 'a6843bfd-9bdd-5271-a584-bd22e038b539', '8f8413e4-543c-5069-9e6a-0c95de00fcb5', '2024-11-05', NULL, NULL),
  ('8358ccc5-5a62-5be1-9478-3de1acce6482', 'f06b497a-1900-510d-aebe-f9a689550a37', 'a479912a-d868-554f-95cc-f982c3044dda', '2024-11-05', NULL, NULL),
  ('d1b3d734-561f-55c6-9286-20e0308c8d8b', 'dfe6f3e8-7aa2-5366-91e1-943154071bca', 'b12d0fb3-4f6d-5d83-9196-3f43851b407f', '2024-11-05', NULL, NULL),
  ('a22dd342-48b6-5a70-8a08-311017cb986b', 'e93a8ed7-07be-5ee4-97fe-2f3c93c40bdd', 'daa12a4c-25d8-5994-a17f-f5caacfbb53c', '2024-11-05', NULL, NULL),
  ('d8771ae7-a277-5606-bc51-0c2cc6329751', '455a18e7-2834-51a7-bac0-fc87f6311bbd', 'a0375dd1-8858-55f8-88ec-2fe934687a98', '2024-11-05', NULL, NULL),
  ('7a1ff5d6-803c-5a7d-bcf4-13280a75e945', 'd42fe32c-015d-583f-908c-69e3a72b1337', '0a6d2eab-5129-5a62-8699-440bf2ee2309', '2023-05-10', NULL, NULL);

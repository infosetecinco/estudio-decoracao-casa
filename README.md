# Estúdio de Decoração — Casa (projeto aprovado)

Ferramenta de decoração em **um único arquivo HTML** sobre a planta aprovada de uma casa de 3 pavimentos (lote 9 × 20 m).

**Acesse:** https://infosetecinco.github.io/estudio-decoracao-casa/

## O que faz
- **Planta 2D** reproduzida das cotas do projeto (mm): paredes estruturais e de vedação desenhadas de forma diferente, portas e janelas conforme o quadro de esquadrias, cotas automáticas ao redor e **área de cada ambiente calculada automaticamente** (confere com as áreas impressas na planta).
- **Móveis em escala real** com um arranjo padrão para os 3 pavimentos: arrastar, girar, redimensionar e **encostar automaticamente na parede** ao se aproximar.
- **Ferramentas:** medição, demolição/alteração de paredes não estruturais (os ambientes se unem e as áreas se recalculam), troca de piso, desfazer/refazer, salvamento local (navegador) e exportação de imagem (PNG) e do projeto (JSON).
- **3D (three.js)** da mesma solução, com vista aérea e **passeio em primeira pessoa** (WASD, sobe a escada).
- **2D ⇄ 3D na mesma página** com transição animada e sincronização em tempo real (inclui modo dividido).

> A estrutura foi **inferida** da planta (fachadas, divisas e paredes que se repetem no pavimento superior). O endereço do imóvel foi omitido nesta versão pública.

## Desenvolvimento
O código-fonte fica em `src/` (módulos concatenados na ordem do nome). Para gerar a página:

```bash
python tools/build.py index.html
```

Testes (Node): `node tools/test-core.js`, `node tools/test-layout.js`, `node tools/test-plan2d.js`, etc. O contrato entre os módulos está em `CONTRACT.md`.
